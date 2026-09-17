import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { palettes, type ColorScheme, type Palette } from '@/constants/theme';

interface ThemeValue {
  scheme: ColorScheme;
  colors: Palette;
  toggleScheme: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always launches light, regardless of the OS setting — dark mode is opt-in from the
  // switch on Settings, not inherited from the system. There's no storage layer yet, so
  // this also means the choice resets to light on every reload.
  const [scheme, setScheme] = useState<ColorScheme>('light');

  const toggleScheme = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setScheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ scheme, colors: palettes[scheme], toggleScheme }),
    [scheme, toggleScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a <ThemeProvider>.');
  }
  return context;
}

type StyleMap = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Declares a component's styles as a function of the palette, and hands back a hook.
 *
 * Each scheme's StyleSheet is built once, the first time it's needed, and cached for the
 * rest of the session — so a component re-styles on a theme change without re-creating
 * styles on every render. Use this for everything except colors that have to be passed
 * as props (icon tints, for instance), which come from `useTheme()` directly.
 */
export function makeStyles<T extends StyleMap>(factory: (colors: Palette) => T) {
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
