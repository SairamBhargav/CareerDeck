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

  /** Auto Apply's distinct "AI-assisted" violet. */
  autoApply: string;
  autoApplyGlow: string;
  /** The rail button's fill — deliberately not `accent`, so the action keeps its identity. */
  autoApplySurface: string;
  autoApplyLabel: string;

  /** The floating tab bar's blurred capsule, dark in both schemes. */
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

  autoApply: '#7B5CFA',
  autoApplyGlow: 'rgba(123, 92, 250, 0.45)',
  autoApplySurface: '#111114',
  autoApplyLabel: '#FFFFFF',

  chromeSurface: 'rgba(255,255,255,0.06)',
  chromeText: '#FFFFFF',
  chromeTextMuted: 'rgba(255,255,255,0.48)',
  chromeBorder: 'transparent',

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
  backgroundMuted: '#17181E',
  surface: '#17181E',
  controlSurface: 'rgba(255,255,255,0.13)',

  border: '#26272F',
  borderStrong: '#3B3C46',

  text: '#F4F4F7',
  textSecondary: '#A9A9B6',
  textTertiary: '#7C7C8A',
  textInverse: '#0E0F13',
  textOnBrand: '#FFFFFF',

  accent: '#F4F4F7',
  accentText: '#0E0F13',

  like: '#FF4D6D',
  likeSurface: 'rgba(255, 77, 109, 0.18)',
  likeBorder: 'rgba(255, 77, 109, 0.38)',

  autoApply: '#A78BFF',
  autoApplyGlow: 'rgba(167, 139, 255, 0.55)',
  autoApplySurface: '#2A2340',
  autoApplyLabel: '#F0EBFF',

  chromeSurface: 'rgba(255,255,255,0.10)',
  chromeText: '#FFFFFF',
  chromeTextMuted: 'rgba(255,255,255,0.52)',
  chromeBorder: 'rgba(255,255,255,0.12)',

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
