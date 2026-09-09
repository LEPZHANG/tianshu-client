/**
 * Tianshu brand token layer: the values this product overrides on top of the
 * active dsh theme, stacked through `ctx.theme.overrideTokens`.
 *
 * Only tokens whose Tianshu value differs from the shipped theme belong here.
 * The layer is global (it lands as inline custom properties on `body`), so it
 * carries brand identity — the frosted sidebar column and the blue that
 * replaces the near-black default brand ink. Ink that must change only INSIDE
 * the column is rebound locally in `TianshuSidebar.module.css`; putting it
 * here would repaint the whole application.
 *
 * The column reads as ice-blue frosted glass (light theme): translucent stops
 * plus the `backdrop-filter` the sidebar stylesheet applies. Dark values keep
 * the column readable under the dark theme — translucent navy glass over the
 * dark surfaces — rather than reusing the light glass, which would strand the
 * white ink on a near-white column.
 */
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Layer identity for `overrideTokens` (one layer per source). */
export const BRAND_TOKEN_SOURCE = '@deepseek-ai/dsh-client-ui-tianshu-brand'

/** Ice-blue glass stops (light theme), the product-approved S4 sidebar finish. */
const BRAND_GLASS_TOP = 'rgba(226, 236, 252, 0.88)'
const BRAND_GLASS_BOTTOM = 'rgba(198, 217, 246, 0.92)'

/** Dark-theme glass stops: translucent navy over the dark surfaces. */
const BRAND_GLASS_DARK_TOP = 'rgba(23, 45, 92, 0.82)'
const BRAND_GLASS_DARK_BOTTOM = 'rgba(16, 30, 62, 0.92)'

/**
 * Tianshu token overrides.
 *
 * `--dsw-specific-sidebar-fill` is a documented overridable token (it appears
 * in ui-theme's `BUILTIN_INSPECT_TOKENS`) and accepts any CSS background
 * value, so the glass gradients ride it directly. The brand blue stays the
 * login page's pinned `#2563EB` (see the dsh-webui-auth stylesheet), so the
 * auth gate and the brand ink must not drift apart.
 */
export const BRAND_TOKENS: ThemeTokenOverrides = {
  '--dsw-specific-sidebar-fill': {
    light: `linear-gradient(180deg, ${BRAND_GLASS_TOP} 0%, ${BRAND_GLASS_BOTTOM} 100%)`,
    dark: `linear-gradient(180deg, ${BRAND_GLASS_DARK_TOP} 0%, ${BRAND_GLASS_DARK_BOTTOM} 100%)`,
  },
  // The shipped brand ink is near-black; Tianshu leads with the blue.
  '--dsw-alias-brand-text': { light: '#2563EB', dark: 'rgb(120, 160, 245)' },
}
