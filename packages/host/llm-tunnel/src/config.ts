/** Settings namespace declaration for the tunnel manager. @module @deepseek-ai/dsh-host-llm-tunnel/config */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** The namespace this plugin owns in the settings service. */
export const NS = settingsNamespace('llm-tunnel')

/** One configured remote host, as `settings.yaml` serializes it. */
const host = z.object({
  host: z.string().required().description('SSH server address or ~/.ssh/config alias'),
  sshPort: z.number().default(22).description('SSH server port'),
  user: z.string().required().description('SSH login user'),
  remoteHost: z.string().default('127.0.0.1').description('Model endpoint host as seen from the SSH server'),
  remotePort: z.number().required().description('Model endpoint port on the remote side'),
  localPort: z.number().required().description('Localhost port the forward listens on'),
})

/** The whole tunnel namespace: a map of host id to its configuration. */
export const Config = z.object({
  hosts: z.dict(host).default({}),
})
