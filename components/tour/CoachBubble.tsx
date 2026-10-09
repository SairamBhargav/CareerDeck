import type { ReactNode } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface CoachBubbleProps {
  kicker: string;
  title: string;
  body: string;
  /** Where it sits: above the content it is not pointing at. */
  position: ViewStyle;
  /** A control that belongs to this step (the theme switch). */
  accessory?: ReactNode;
  /** For steps that are read rather than done. */
  action?: { label: string; onPress: () => void };
}

/**
 * The tour's voice. The page's own ink, inverted, so it reads as a layer over the app rather
 * than as a piece of it, in either scheme.
 */
export function CoachBubble({ kicker, title, body, position, accessory, action }: CoachBubbleProps) {
  const { scheme } = useTheme();
  const styles = useStyles();

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(120)}
      style={[styles.bubble, position]}
      accessibilityLiveRegion="polite">
      <Text style={[styles.kicker, { color: scheme === 'dark' ? '#5B3DE0' : '#C9BEFF' }]}>{kicker}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      {accessory || action ? (
        <View style={styles.row}>
          {accessory}
          <View style={styles.spacer} />
          {action ? (
            <Pressable
              onPress={action.onPress}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: {
    position: 'absolute',
    padding: spacing.lg,
    paddingTop: spacing.lg + 2,
    gap: 6,
    borderRadius: radius.xl - 4,
    backgroundColor: colors.text,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  kicker: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: fontSize.title + 2,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.background,
  },
  body: {
    fontSize: fontSize.body - 1,
    lineHeight: 20,
    color: colors.background,
    opacity: 0.78,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
  action: {
    height: 40,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  actionLabel: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
}));
