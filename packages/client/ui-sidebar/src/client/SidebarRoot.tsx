/**
 * Sidebar shell: column geometry only. Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts and the four upper
 * controls enter the 56px rail from the same horizontal offset (one icon each,
 * same top-down order) on one fade that ends with the slide. The bottom-pinned
 * settings control only fades. The workspace/session browsing region between
 * the New Session button and the foot is the `sidebar.workspaces` registrant's,
 * and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
 * hands them the wide flag (plus an expand request callback for the browser).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import {
  BrandWordmark, FishLogo,
  SidebarBrandButton, SidebarColumn, SidebarFoot, SidebarNewSessionButton, SidebarToggleButton,
  useSidebarCollapse, useSidebarScrollbars,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  const collapse = useSidebarCollapse(collapsed, width)
  const bars = useSidebarScrollbars()
  const { wide } = collapse

  return (
    <SidebarColumn classes={css} collapsed={collapsed} width={width} collapse={collapse} bars={bars}>
      <div className={css.logoRow}>
        {/* Expanded, the wordmark doubles as a New Session shortcut; the
            collapsed rail's logo is the expand toggle below instead. */}
        {wide && (
          <SidebarBrandButton classes={css} label={t('session.new.label')} onActivate={startSession}>
            <BrandWordmark />
          </SidebarBrandButton>
        )}
        {/* Rail resting state is the whale mark; hovering swaps in the panel
            icon (the expand affordance, figma sidebar-hover flow). */}
        <SidebarToggleButton
          classes={css}
          label={collapsed ? t('toggle.open') : t('toggle.collapse')}
          wide={wide}
          onToggle={toggleSidebar}
          railMark={<FishLogo className={css.railFish} size={24} />}
        />
      </div>

      <SidebarNewSessionButton
        classes={css}
        label={t('session.new.label')}
        text={t('session.new')}
        wide={wide}
        wideIconSize={14}
        onStart={startSession}
      />

      {/* The browsing region fills the column between the controls and the
          foot in both states; its rail icon column rides the same slot. */}
      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      <SidebarFoot
        classes={css}
        actions={renderSlot('sidebar.footer.action', { wide })}
        settings={renderSlot('sidebar.settings', { wide })}
      />
    </SidebarColumn>
  )
}
