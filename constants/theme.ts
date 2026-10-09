import type { ViewStyle } from 'react-native';

/**
 * Central design tokens for CareerDeck.
 *
 * Geometry (spacing, radius, type scale) is scheme-independent and exported directly.
 * Anything that changes between light and dark lives in a `Palette` — components never
 * import a palette themselves, they get one via `makeStyles()` / `useTheme()` so the
 * whole app can repaint at runtime.
 */

export type ColorScheme = 'light' | 'dark';

export interface Palette {
  /** App shell. */
  background: string;
  backgroundMuted: string;
  /** A whole page one step off `background`: the Deck behind its reels. Dark keeps this near-black, unlike muted fills. */
  canvasMuted: string;
  surface: string;
  /**
   * Controls that float *on top* of content rather than sitting in the page — the reel
   * action rail, the Read more pill. Opaque in light, translucent white in dark so they
   * lift off a company-tinted reel instead of disappearing into it.
   */
  controlSurface: string;

  border: string;
  borderStrong: string;

  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Flips with the scheme — for text on a `text`-colored fill. */
  textInverse: string;
  /** Never flips: text and icons sitting on a company's own brand color. */
  textOnBrand: string;

  accent: string;
  accentText: string;

  like: string;
  likeSurface: string;
  likeBorder: string;

  /**
   * Something the user has to act on: a resume the parser could not read, a failed upload.
   *
   * Added in phase 4, which is where the app got its first state that is neither "working" nor
   * "loading". Deliberately not `like` — a heart and a failure reading in the same red would
   * make one of them mean less.
   */
  danger: string;

  /** The weekly goal ring once the week is done, and the streak marks behind it. */
  goalMet: string;
  goalMetSurface: string;

  /** Auto Apply's distinct "AI-assisted" violet. */
  autoApply: string;
  autoApplyGlow: string;
  /** The rail button's fill — deliberately not `accent`, so the action keeps its identity. */
  autoApplySurface: string;
  autoApplyLabel: string;
  /** The flash glyph on the Auto Apply button: white on violet in light, violet on its dark plate in dark. */
  autoApplyIcon: string;
  /** The credit count riding on the button's corner. */
  autoApplyBadge: string;
  autoApplyBadgeText: string;

  /**
   * The plate a company's logo image sits on. Pure white in light; a soft off-white in dark,
   * where a full-white square glares against the page.
   */
  logoPlate: string;

  /** The floating tab bar's blurred capsule, dark in both schemes. */
  /**
   * The tab bar's own tint, behind its blur.
   *
   * Translucent on purpose: the bar used to sit on an opaque `surface`, which gave the
   * blur a solid wall to sample and made a frosted material look like a painted one.
   */
  chromeFill: string;
  chromeSurface: string;
  chromeText: string;
  chromeTextMuted: string;
  chromeBorder: string;

  /**
   * How strongly a company's brand color tints its reel. Dark mode leans much harder on
   * both: over near-black, a 7% wash is invisible, and the glow has to read as a light
   * source rather than a smudge.
   */
  reelWashAlpha: number;
  reelGlowAlpha: number;
  /** Pre-blended stand-in for the rare company with no brand color. */
  reelGlowFallback: string;

  shadowSoft: ViewStyle;
  shadowLifted: ViewStyle;
}

const lightPalette: Palette = {
  background: '#FFFFFF',
  backgroundMuted: '#F6F6F7',
  canvasMuted: '#F6F6F7',
  surface: '#FFFFFF',
  controlSurface: '#FFFFFF',

  border: '#E8E8EC',
  borderStrong: '#D7D7DE',

  text: '#111114',
  textSecondary: '#5C5C68',
  textTertiary: '#8E8E9A',
  textInverse: '#FFFFFF',
  textOnBrand: '#FFFFFF',

  accent: '#111114',
  accentText: '#FFFFFF',

  like: '#FF3B5C',
  likeSurface: '#FFECEF',
  likeBorder: '#FFD3DA',

  danger: '#C4341E',

  goalMet: '#12A150',
  goalMetSurface: '#E4F6EB',

  autoApply: '#7B5CFA',
  autoApplyGlow: 'rgba(123, 92, 250, 0.45)',
  autoApplySurface: '#7B5CFA',
  autoApplyLabel: '#FFFFFF',
  autoApplyIcon: '#FFFFFF',
  autoApplyBadge: '#FFFFFF',
  autoApplyBadgeText: '#5B3DE0',

  logoPlate: '#FFFFFF',

  chromeFill: 'rgba(255,255,255,0.14)',
  // The selected capsule is lighter than the bar it sits in, which is what separates it
  // without a second colour.
  chromeSurface: 'rgba(255,255,255,0.75)',
  chromeText: '#111114',
  chromeTextMuted: 'rgba(17,17,20,0.46)',
  /*
   * A soft dark hairline, where this was white.
   *
   * White was borrowed from the dark scheme, where a pale rim is how glass separates
   * itself from what is behind it. Over a light feed it has nothing to separate from — a
   * white edge on a near-white page is no edge at all. Ink at twelve percent is enough to
   * say where the bar stops without drawing a line anybody notices.
   */
  chromeBorder: 'rgba(17,17,20,0.12)',

  reelWashAlpha: 0.07,
  reelGlowAlpha: 0.22,
  reelGlowFallback: 'rgba(17, 17, 20, 0.14)',

  shadowSoft: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  shadowLifted: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};

const darkPalette: Palette = {
  // The same near-black the splash screen and Android adaptive icon already use.
  background: '#0E0F13',
  // Lighter than surface, as light mode's muted grey is darker than white: either way a
  // muted fill has to read inside a card. These were the same colour, which made every ring
  // track, progress track and chip inside a card disappear.
  backgroundMuted: '#24252D',
  canvasMuted: '#13141A',
  surface: '#18191F',
  controlSurface: 'rgba(255,255,255,0.13)',

  // A step lighter than before: hairlines on near-black were close to invisible, and
  // borders are what separates surfaces in dark, where shadows cannot.
  border: '#2C2D36',
  borderStrong: '#45464F',

  text: '#F7F7FA',
  textSecondary: '#B5B5C1',
  textTertiary: '#8A8A98',
  textInverse: '#0E0F13',
  textOnBrand: '#FFFFFF',

  accent: '#F4F4F7',
  accentText: '#0E0F13',

  like: '#FF4D6D',
  likeSurface: 'rgba(255, 77, 109, 0.18)',
  likeBorder: 'rgba(255, 77, 109, 0.38)',

  // Lighter than its light-mode counterpart: a deep red on a dark surface reads as brown
  // before it reads as a warning.
  danger: '#FF8A75',

  // Lifted off the light value: #12A150 goes muddy against near-black.
  goalMet: '#34D77F',
  goalMetSurface: 'rgba(52, 215, 127, 0.16)',

  autoApply: '#A78BFF',
  autoApplyGlow: 'rgba(167, 139, 255, 0.55)',
  autoApplySurface: '#2A2340',
  autoApplyLabel: '#F0EBFF',
  autoApplyIcon: '#A78BFF',
  autoApplyBadge: '#A78BFF',
  autoApplyBadgeText: '#FFFFFF',

  logoPlate: '#EEEEF2',

  chromeFill: 'rgba(12,12,16,0.14)',
  chromeSurface: 'rgba(255,255,255,0.14)',
  chromeText: '#FFFFFF',
  chromeTextMuted: 'rgba(255,255,255,0.52)',
  // Stays pale: in dark the page behind is darker than the bar, so light is what reads.
  chromeBorder: 'rgba(255,255,255,0.22)',

  reelWashAlpha: 0.2,
  reelGlowAlpha: 0.4,
  reelGlowFallback: 'rgba(255, 255, 255, 0.08)',

  // Black shadows do nothing on a near-black page, so dark leans on heavier, wider ones
  // plus the visible borders above to separate surfaces.
  shadowSoft: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  shadowLifted: {
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};

export const palettes: Record<ColorScheme, Palette> = {
  light: lightPalette,
  dark: darkPalette,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const fontSize = {
  caption: 11,
  small: 13,
  body: 15,
  title: 18,
  heading: 22,
  display: 30,
  hero: 34,
} as const;

/** Horizontal padding used by every screen so content lines up across tabs. */
export const screenPadding = spacing.lg;

/** Minimum touch target recommended by both iOS and Android guidelines. */
export const minTapTarget = 44;

/**
 * Height of the floating bottom tab bar's own pill, excluding the device's bottom
 * safe-area inset and the gap beneath it. The tab bar is absolutely positioned (it
 * floats over scrolling content rather than pushing it up), so screens add the total
 * via useTabBarHeight() themselves.
 */
export const tabBarHeight = 58;

/** Gap between the floating tab bar pill and the bottom safe-area edge — the "hover". */
export const tabBarFloatGap = 14;
