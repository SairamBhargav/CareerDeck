/**
 * Central design tokens for CareerDeck.
 *
 * Everything visual should come from here. The palette is intentionally neutral
 * (near-black / warm grey / single accent) so branding can be swapped later by
 * editing only this file.
 */

export const colors = {
  /** App shell (Home, Profile) */
  background: '#FFFFFF',
  backgroundMuted: '#F6F6F7',
  surface: '#FFFFFF',
  surfaceRaised: '#FAFAFB',

  border: '#E8E8EC',
  borderStrong: '#D7D7DE',

  text: '#111114',
  textSecondary: '#5C5C68',
  textTertiary: '#8E8E9A',
  textInverse: '#FFFFFF',

  accent: '#111114',
  accentText: '#FFFFFF',

  like: '#FF3B5C',
  save: '#111114',

  /** Auto Apply's distinct "AI-assisted" accent — violet instead of the neutral accent. */
  autoApply: '#7B5CFA',
  autoApplyGlow: 'rgba(123, 92, 250, 0.45)',

  /** Reels surface (immersive, dark) */
  reelBackground: '#0E0F13',
  reelSurface: 'rgba(255,255,255,0.06)',
  reelBorder: 'rgba(255,255,255,0.12)',
  reelText: '#FFFFFF',
  reelTextSecondary: 'rgba(255,255,255,0.72)',
  reelTextTertiary: 'rgba(255,255,255,0.48)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
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

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
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

export const shadow = {
  soft: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  lifted: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

export const theme = {
  colors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  screenPadding,
  shadow,
  tabBarHeight,
  tabBarFloatGap,
} as const;
