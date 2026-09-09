/**
 * The card that declares a remote GPU reached over an SSH port-forward
 * tunnel: one settings write lands the host in `llm-tunnel` (whose plugin
 * spawns the forward) and the provider row in `llm-pi-ai` pointing at the
 * forwarded local port, so the model layer serves the GPU through the
 * ordinary provider path.
 *
 * The test button probes the tunnel's model endpoint through the host-side
 * RPC (`llmTunnel.probe`) — but the tunnel only exists after the settings
 * write, so the card's flow is create-then-test: the create enables as soon
 * as the fields validate, and the test answer (with its model count) lands
 * on the provider row the Models UI already renders, where "fetch available
 * models" re-asks the endpoint with the picker.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, TunnelProbeResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { EditorFooter } from './EditorFooter.tsx'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Same route-id contract as the custom-provider card, plus the tunnel stems. */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** The tunnel RPC face the api-remotes assembly re-exports for consumers. */
export interface RemoteGpuTunnelFace {
  /** `llmTunnel.probe`: does the endpoint answer through the forward? */
  probe: (id: never) => Promise<RemoteResult<TunnelProbeResult & { models: readonly { id: string }[] }>>
}

/** Props of {@link RemoteGpuCard}. */
export interface RemoteGpuCardProps {
  /** Route ids already declared, so the card refuses to shadow one. */
  taken: readonly string[]
  /** Revision of the `llm-pi-ai` user section, guarding the create race. */
  revision: number
  /** Wire faces for the two settings writes. */
  api: Pick<IApiClient, 'settings'>
  /** The tunnel RPC face (`ctx.remote.llmTunnel`). */
  tunnel: RemoteGpuTunnelFace
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the card; `changed` reports whether anything was created. */
  onClose: (changed: boolean) => void
}

/**
 * Render the remote-GPU creation card.
 * @param props - existing routes, revisions, wire faces, and copy.
 * @returns the creation card.
 */
export function RemoteGpuCard(props: RemoteGpuCardProps): ReactNode {
  const { taken, api, tunnel, t } = props
  const [openedAt] = useState(() => props.revision)
  const [id, setId] = useState('')
  const [host, setHost] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [user, setUser] = useState('')
  const [remotePort, setRemotePort] = useState('8000')
  const [localPort, setLocalPort] = useState('18000')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [committed, setCommitted] = useState(false)
  const disabled = props.readOnly || busy

  const idInvalid = id.length > 0 && !ROUTE_PATTERN.test(id)
  const idTaken = taken.includes(id)
  const portOf = (raw: string): number | undefined => {
    const value = Number(raw)
    return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined
  }
  const sshPortValue = portOf(sshPort)
  const remotePortValue = portOf(remotePort)
  const localPortValue = portOf(localPort)
  const portsValid = sshPortValue !== undefined && remotePortValue !== undefined && localPortValue !== undefined
  const ready = id.length > 0 && !idInvalid && !idTaken && host.length > 0 && user.length > 0 && portsValid

  const hint = failure !== undefined || ready || id.length === 0 || idInvalid || idTaken
    ? undefined
    : host.length === 0
      ? t('remoteGpuNeedsHost')
      : user.length === 0
        ? t('remoteGpuNeedsUser')
        : portsValid ? undefined : t('remoteGpuPortInvalid')

  /** Persist both rows: the tunnel host and the provider pointing at it. */
  const createOnce = async (): Promise<string | undefined> => {
    const hostProfile = {
      host, sshPort: sshPortValue!, user,
      remoteHost: '127.0.0.1', remotePort: remotePortValue!, localPort: localPortValue!,
    }
    const tunnelWrite = await api.settings.mutate({
      ns: 'llm-tunnel',
      ops: [{ op: 'set', path: ['hosts', id], value: hostProfile }],
    })
    if (!tunnelWrite.result.ok) return tunnelWrite.result.error.message
    // The provider row is what the model layer actually reads; no key: an
    // SSH-forwarded local endpoint typically runs unauthenticated, and the
    // editor can add one later if the deployment requires it.
    const providerWrite = await api.settings.mutate({
      ns: 'llm-pi-ai',
      ops: [{
        op: 'set',
        path: ['providers', id],
        value: { displayName: `${id} (SSH)`, api: 'openai-completions', baseURL: `http://127.0.0.1:${String(localPortValue)}/v1`, models: [] },
      }],
      expectedRevision: openedAt,
    })
    if (!providerWrite.result.ok) {
      // Roll the tunnel row back so a retry is not half-declared: the
      // provider write failed on a revision race the user must re-open for.
      await api.settings.mutate({
        ns: 'llm-tunnel',
        ops: [{ op: 'unset', path: ['hosts', id] }],
      })
      return providerWrite.result.error.message
    }
    setCommitted(true)
    return undefined
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await createOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      props.onClose(true)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  /** Probe the just-created tunnel; the count guides the next step. */
  const test = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      // The route id the card holds crosses the branded boundary here: the
      // host owns TunnelHostId, and this card's id is its settings key.
      const response = await tunnel.probe(id as never)
      // RemoteResult narrows on `ok`: the wire failure carries its message,
      // the probe failure carries the chain's diagnostic.
      if (!response.ok) {
        const template = t('remoteGpuTestFail')
        setFailure(template.replace('{reason}', response.error.message))
        return
      }
      if (!response.value.ok) {
        // The locale template carries a {reason} hole; splice the diagnostic
        // in here because the footer-grade t has no interpolation seat.
        const template = t('remoteGpuTestFail')
        setFailure(template.replace('{reason}', response.value.detail ?? 'unknown'))
        return
      }
      setFailure(undefined)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['editor']}>
      <div className={styles['editorHeader']}>
        <span className={styles['editorTitle']}>{t('remoteGpuTitle')}</span>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('remoteGpuId')}</span>
        <input
          className={styles['input']}
          type="text"
          value={id}
          placeholder="my-gpu"
          aria-label={t('remoteGpuId')}
          disabled={disabled || committed}
          onChange={(event) => { setId(event.target.value) }}
        />
        {idInvalid || idTaken
          ? <p className={styles['error']}>{t(idInvalid ? 'customRouteInvalid' : 'remoteGpuIdTaken')}</p>
          : <p className={styles['advancedHint']}>{t('remoteGpuIdHint')}</p>}
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('remoteGpuHost')}</span>
        <input
          className={styles['input']}
          type="text"
          value={host}
          placeholder={t('remoteGpuHostPlaceholder')}
          aria-label={t('remoteGpuHost')}
          disabled={disabled || committed}
          onChange={(event) => { setHost(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('remoteGpuUser')}</span>
        <input
          className={styles['input']}
          type="text"
          value={user}
          placeholder="ops"
          aria-label={t('remoteGpuUser')}
          disabled={disabled || committed}
          onChange={(event) => { setUser(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('remoteGpuSshPort')}</span>
        <input
          className={styles['input']}
          type="number"
          value={sshPort}
          aria-label={t('remoteGpuSshPort')}
          disabled={disabled || committed}
          onChange={(event) => { setSshPort(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('remoteGpuRemotePort')}</span>
        <input
          className={styles['input']}
          type="number"
          value={remotePort}
          aria-label={t('remoteGpuRemotePort')}
          disabled={disabled || committed}
          onChange={(event) => { setRemotePort(event.target.value) }}
        />
        <p className={styles['advancedHint']}>{t('remoteGpuRemotePortHint')}</p>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('remoteGpuLocalPort')}</span>
        <input
          className={styles['input']}
          type="number"
          value={localPort}
          aria-label={t('remoteGpuLocalPort')}
          disabled={disabled || committed}
          onChange={(event) => { setLocalPort(event.target.value) }}
        />
      </div>
      <p className={styles['advancedHint']}>{t('remoteGpuKeyHint')}</p>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {hint === undefined ? null : <p className={styles['advancedHint']}>{hint}</p>}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || !ready}
        submitLabel="remoteGpuCreate"
        submitBusyLabel="remoteGpuCreating"
        onCancel={() => { props.onClose(committed) }}
        onSubmit={() => { void create() }}
      />
      {committed
        ? (
          <button
            type="button"
            className={styles['presetChip']}
            disabled={disabled}
            onClick={() => { void test() }}
          >{busy ? t('remoteGpuTesting') : t('remoteGpuTest')}</button>
        )
        : null}
    </div>
  )
}
