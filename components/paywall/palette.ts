import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { Easing } from 'react-native-reanimated';

import type { ColorScheme } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

/**
 * The paywall's own two palettes, picked by the app's scheme.
 *
 * Dark is the cinematic stage: near-black, with the aurora glowing through it. Light is the
 * same scene by day: a lavender-white page, the aurora as pastel washes, and white cards with
 * soft shadows. The brand colours stay put in both (Auto Apply's violet, the CTA's
 * violet-to-magenta, the gold badge), so it reads as one paywall in two lights.
 */
export interface PaywallPalette {
  scheme: ColorScheme;
  statusBar: 'light' | 'dark';

  background: string;
  violet: string;
  /** Violet for text and icons: lighter on dark, deeper on light, for contrast. */
  violetText: string;
  magenta: string;
  blue: string;
  gold: string;
  success: string;

  text: string;
  textSecondary: string;
  textTertiary: string;

  /** Plan cards, the close button. */
  glass: string;
  glassStrong: string;
  hairline: string;
  /** Violet-tinted fills: feature icons, chips. */
  tintSoft: string;
  ringFill: string;
  radioBorder: string;

  /** The mock job cards in the hero. */
  card: string;
  cardBorder: string;
  cardShadowOpacity: number;
  skeleton: string;
  stampFill: string;

  /** Aurora strength: pastel washes on light, full glow on dark. */
  blobOpacity: number;
  star: string;
  starPeak: number;

  bottomBar: string;
  nodeFill: string;
  nodeBorder: string;
  goldSoft: string;
  /** Activity's Pro card. */
  promoCard: string;
  promoFrame: string;
  /** The confetti piece that is neither brand colour: white on dark, ink on light. */
  confettiNeutral: string;
}

const dark: PaywallPalette = {
  scheme: 'dark',
  statusBar: 'light',
  background: '#07060D',
  violet: '#7B5CFA',
  violetText: '#A08BFF',
  magenta: '#E255C9',
  blue: '#3D7BFF',
  gold: '#FFC94D',
  success: '#3DDC84',
  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.72)',
  textTertiary: 'rgba(255,255,255,0.48)',
  glass: 'rgba(255,255,255,0.06)',
  glassStrong: 'rgba(255,255,255,0.10)',
  hairline: 'rgba(255,255,255,0.12)',
  tintSoft: 'rgba(123,92,250,0.22)',
  ringFill: 'rgba(123,92,250,0.14)',
  radioBorder: 'rgba(255,255,255,0.4)',
  card: '#15131F',
  cardBorder: 'rgba(255,255,255,0.16)',
  cardShadowOpacity: 0.5,
  skeleton: 'rgba(255,255,255,0.08)',
  stampFill: 'rgba(61,220,132,0.12)',
  blobOpacity: 1,
  star: '#FFFFFF',
  starPeak: 0.95,
  bottomBar: 'rgba(7,6,13,0.82)',
  nodeFill: '#1B1730',
  nodeBorder: 'rgba(160,139,255,0.5)',
  goldSoft: 'rgba(255,201,77,0.12)',
  promoCard: '#100E1A',
  promoFrame: 'rgba(123,92,250,0.25)',
  confettiNeutral: '#FFFFFF',
};

const light: PaywallPalette = {
  scheme: 'light',
  statusBar: 'dark',
  background: '#F7F5FF',
  violet: '#7B5CFA',
  violetText: '#5B3DE0',
  magenta: '#DD4BC2',
  blue: '#3D7BFF',
  gold: '#FFBE2E',
  success: '#12A150',
  text: '#14121F',
  textSecondary: 'rgba(20,18,31,0.68)',
  textTertiary: 'rgba(20,18,31,0.45)',
  glass: 'rgba(255,255,255,0.78)',
  glassStrong: 'rgba(20,18,31,0.06)',
  hairline: 'rgba(20,18,31,0.10)',
  tintSoft: 'rgba(123,92,250,0.12)',
  ringFill: 'rgba(123,92,250,0.07)',
  radioBorder: 'rgba(20,18,31,0.25)',
  card: '#FFFFFF',
  cardBorder: 'rgba(20,18,31,0.07)',
  cardShadowOpacity: 0.12,
  skeleton: 'rgba(20,18,31,0.07)',
  stampFill: 'rgba(18,161,80,0.10)',
  blobOpacity: 0.5,
  star: '#7B5CFA',
  starPeak: 0.55,
  bottomBar: 'rgba(247,245,255,0.9)',
  nodeFill: '#FFFFFF',
  nodeBorder: 'rgba(123,92,250,0.35)',
  goldSoft: 'rgba(255,190,46,0.18)',
  promoCard: '#FFFFFF',
  promoFrame: 'rgba(123,92,250,0.18)',
  confettiNeutral: '#14121F',
};

const palettes: Record<ColorScheme, PaywallPalette> = { dark, light };

export function usePaywallColors(): PaywallPalette {
  return palettes[useTheme().scheme];
}

type StyleMap = Record<string, ViewStyle | TextStyle | ImageStyle>;

/** `makeStyles`, over the paywall's palette instead of the app's. One sheet per scheme. */
export function makePaywallStyles<T extends StyleMap>(factory: (c: PaywallPalette) => T) {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return function useStyles(): T {
    const { scheme } = useTheme();
    const cached = cache[scheme];
    if (cached) return cached;
    const created = StyleSheet.create(factory(palettes[scheme])) as T;
    cache[scheme] = created;
    return created;
  };
}

/** Strong ease-out for anything entering, and the on-screen move curve. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** Slow drifts: symmetric, so a reversing loop has no visible seam. */
export const EASE_DRIFT = Easing.inOut(Easing.sin);

/** A tiny seeded generator, so particle layouts are the same on every render. */
export function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
