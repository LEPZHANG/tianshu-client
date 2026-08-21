/**
 * The management surfaces the sidebar's navigation opens: 任务管理 and 会话管理.
 *
 * Registered into `shell.overlay`, so the surface is mounted for the whole
 * session and paints only when a destination is selected; with none it renders
 * `null` and the click-through layer stays out of the way. This keeps the
 * conversation column untouched — `conversation` is a single slot owned by
 * ui-conversation, and occupying it would displace the whole chat surface.
 *
 * What the pages can honestly show is bounded by what the host actually has;
 * see the package README's Known Limitations before adding to them.
 */
import clsx from 'clsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TianshuPagesComponentProps } from './contract/slots.ts'
import css from './TianshuPages.module.css'

/**
 * Template catalogue. These are presentation-only: the host has no template
 * concept, so selecting one cannot create anything yet (README).
 */
const TEMPLATES: readonly { id: string; name: 'tpl.backup' | 'tpl.summary' | 'tpl.report'; tag: 'tpl.tag.image' | 'tpl.tag.text' }[] = [
  { id: 'backup', name: 'tpl.backup', tag: 'tpl.tag.image' },
  { id: 'summary', name: 'tpl.summary', tag: 'tpl.tag.text' },
  { id: 'report', name: 'tpl.report', tag: 'tpl.tag.text' },
]

/**
 * Render the management surface for the selected destination.
 * @param props - composed slot props (nav store + locale seat, contract/slots.ts).
 * @returns the page tree, or null when no destination is open.
 */
export function TianshuPages({ useStore, actions, useSessions, t }: TianshuPagesComponentProps) {
  const active = useStore(s => s.active)
  // Session rows come from the framework's standard delivery, so the list is
  // the same truth the sidebar browser renders. `ids` carries host order.
  const sessionIds = useSessions(s => s.ids)
  const sessionsById = useSessions(s => s.byId)

  if (active === undefined) return null

  const heading = active === 'tasks' ? 'page.tasks.title' : active === 'sessions' ? 'page.sessions.title' : 'page.config.title'
  const caption = active === 'tasks' ? 'page.tasks.caption' : active === 'sessions' ? 'page.sessions.caption' : 'page.config.caption'

  return (
    <div className={css.root}>
      {/* First grid track is the sidebar's: left empty so it stays operable. */}
      <div className={css.pane}>
        <header className={css.head}>
          <div>
            <h1 className={css.title}>{t(heading)}</h1>
            <p className={css.caption}>{t(caption)}</p>
          </div>
          <button type="button" className={css.close} aria-label={t('page.close')} onClick={() => { actions.clear() }}>
            <IconCloseOutline16 size={16} />
          </button>
        </header>

        <div className={css.body}>
          {active === 'tasks' && (
            <>
              <section>
                <h2 className={css.sectionTitle}>{t('page.tasks.templates')}</h2>
                {/* Presentation-only: no host template concept exists to create from. */}
                <p className={css.notice}>{t('page.tasks.templatesNotice')}</p>
                <div className={css.grid}>
                  {TEMPLATES.map(tpl => (
                    <article key={tpl.id} className={css.card}>
                      <div className={css.cardHead}>
                        <span className={css.cardName}>{t(tpl.name)}</span>
                        <span className={css.tag}>{t(tpl.tag)}</span>
                      </div>
                      <p className={css.cardBody}>{t('tpl.placeholder')}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h2 className={css.sectionTitle}>{t('page.tasks.mine')}</h2>
                {/* Scheduled reminders are session-scoped model tools, not a
                    cross-session task table; there is nothing global to list. */}
                <p className={css.empty}>{t('page.tasks.empty')}</p>
              </section>
            </>
          )}

          {active === 'sessions' && (
            <section>
              <h2 className={css.sectionTitle}>{t('page.sessions.all')}</h2>
              {sessionIds.length === 0
                ? <p className={css.empty}>{t('page.sessions.empty')}</p>
                : (
                  <ul className={css.list}>
                    {sessionIds.map((id) => {
                      const session = sessionsById[id]
                      // Same rule the workspace tree applies (rows/Rows.tsx):
                      // a blank session is named for what it is, so the two
                      // surfaces do not give one session two names. A titled
                      // session that has gone untitled falls back separately.
                      const untitled = session?.blank === true || (session?.title ?? '') === ''
                      return (
                        <li key={id} className={css.row}>
                          <span className={clsx(css.rowTitle, untitled && css.rowUntitled)}>
                            {untitled ? t('page.sessions.untitled') : session?.title}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
            </section>
          )}

          {active === 'config' && (
            // Settings already own this surface; pointing at it beats a second
            // configuration screen that would drift from the real one.
            <p className={css.notice}>{t('page.config.notice')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
