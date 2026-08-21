/**
 * Tianshu brand token layer: the values this product overrides on top of the
 * active dsh theme, stacked through `ctx.theme.overrideTokens`.
 *
 * Only tokens whose Tianshu value differs from the shipped theme belong here.
 * The layer is global (it lands as inline custom properties on `body`), so it
 * carries brand identity — the saturated sidebar column and the blue that
 * replaces the near-black default brand ink. Ink that must change only INSIDE
 * the blue column is rebound locally in `TianshuSidebar.module.css`; putting it
 * here would repaint the whole application.
 *
 * Dark values keep the column readable under the dark theme rather than
 * reusing the light gradient, which would strand light-on-light text.
 */
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Layer identity for `overrideTokens` (one layer per source). */
export const BRAND_TOKEN_SOURCE = '@deepseek-ai/dsh-client-ui-tianshu-brand'

/**
 * 天枢蓝, the platform's specified primary. It is close to but not the same as
 * the shipped `--dsw-static-deepseek-500` (`rgb(65,118,230)`), so the login
 * page's own stylesheet pins the identical value rather than reading that
 * static — the two must not drift apart.
 */
const BRAND_BLUE = '#2563EB'

/** Deeper stop of the column gradient (light theme). */
const BRAND_BLUE_DEEP = '#1D4ED8'

/** Dark-theme column stops: same hue family, dropped into the dark surface range. */
const BRAND_BLUE_DARK_TOP = 'rgb(23, 45, 92)'
const BRAND_BLUE_DARK_BOTTOM = 'rgb(16, 30, 62)'

/**
 * Tianshu token overrides.
 *
 * `--dsw-specific-sidebar-fill` is a documented overridable token (it appears
 * in ui-theme's `BUILTIN_INSPECT_TOKENS`) and accepts any CSS background
 * value, so the design's vertical gradient rides it directly.
 */
export const BRAND_TOKENS: ThemeTokenOverrides = {
  '--dsw-specific-sidebar-fill': {
    light: `linear-gradient(180deg, ${BRAND_BLUE} 0%, ${BRAND_BLUE_DEEP} 100%)`,
    dark: `linear-gradient(180deg, ${BRAND_BLUE_DARK_TOP} 0%, ${BRAND_BLUE_DARK_BOTTOM} 100%)`,
  },
  // The shipped brand ink is near-black; Tianshu leads with the blue.
  '--dsw-alias-brand-text': { light: BRAND_BLUE, dark: 'rgb(120, 160, 245)' },
}
