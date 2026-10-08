/**
 * The title bar every provider card opens with.
 *
 * The cards title themselves differently — a fixed heading for the two creation
 * cards, the profile's display name for the editor — and the row carries no such
 * knowledge: it renders what it is handed.
 *
 * @module dsh-client-ui-settings-models/client/EditorHeader
 */

import styles from './ModelsSection.module.css'

/** Props of {@link EditorHeader}. */
export interface EditorHeaderProps {
  /** The card's heading. */
  title: string
  /** The route behind the heading, drawn only when it says something the title does not. */
  route?: string | undefined
}

/**
 * Render a provider card's title bar.
 * @param props - the heading and its optional route.
 * @returns the header row.
 */
export function EditorHeader({ title, route }: EditorHeaderProps) {
  return (
    <div className={styles['editorHeader']}>
      <span className={styles['editorTitle']}>{title}</span>
      {route !== undefined && <span className={styles['editorRoute']}>{route}</span>}
    </div>
  )
}
