import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

/**
 * How long the offer stands.
 *
 * Long enough to notice and reach, short enough that it is gone before it becomes
 * furniture. Four and a half seconds is the low end of Material's guidance, which is the
 * right end here: the thing it undoes is one row, not a deletion.
 */
const DISMISS_MS = 4500;

const FADE = { duration: 180 };

export interface UndoBarContent {
  message: string;
  /**
   * A next step offered beside the undo, never instead of it.
   *
   * This is how Home recommends applying to a job you just swiped right on: the suggestion
   * sits where your attention already is and costs nothing to ignore, rather than opening a
   * sheet over the feed you are still reading.
   */
  action?: { label: string; onPress: () => void };
}

interface UndoBarProps {
  /**
   * `null` hides the bar. Must be held in state rather than built inline — the dismissal
   * timer restarts on a new object, so a fresh one every render would never expire.
   */
  content: UndoBarContent | null;
  onUndo: () => void;
  onDismiss: () => void;
  /** Clears the floating tab bar, which the caller is the only one that knows the height of. */
  bottomOffset: number;
}

/**
 * The bar that makes a swipe safe to get wrong.
 *
 * Swiping left writes `hide`, which the ranker treats as a hard filter — that posting is
 * gone from every recommended feed from then on. A flick is easy to do by accident, and
 * without this there is no way back from one.
 */
export function UndoBar({ content, onUndo, onDismiss, bottomOffset }: UndoBarProps) {
  const styles = useStyles();
  const progress = useSharedValue(0);

  /*
   * The last content is kept after it goes null so there is something to read while the bar
   * animates out. Clearing it with the animation would blank the text and then slide an
   * empty bar away.
   *
   * Adjusted during render rather than from an effect. React's documented way to derive
   * state from a prop that changed, and the only one that does not paint a blank bar for a
   * frame first.
   */
  const [seen, setSeen] = useState(content);
  const [held, setHeld] = useState(content);
  if (content !== seen) {
    setSeen(content);
    if (content) setHeld(content);
  }

  useEffect(() => {
    progress.set(withTiming(content ? 1 : 0, FADE));
  }, [content, progress]);

  useEffect(() => {
    if (!content) return;
    const timer = setTimeout(onDismiss, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [content, onDismiss]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));

  if (!held) return null;

  return (
    <Animated.View
      style={[styles.bar, { bottom: bottomOffset }, style]}
      // Announced when it appears, but it never takes focus: the reader is mid-feed and the
      // offer is optional.
      accessibilityLiveRegion="polite"
      // Gone means gone. Leaving it tappable through its own fade-out would let a late tap
      // undo something the bar had already stopped offering.
      pointerEvents={content ? 'auto' : 'none'}>
      <Text style={styles.message} numberOfLines={1}>
        {held.message}
      </Text>

      {held.action ? (
        <Pressable
          onPress={held.action.onPress}
          accessibilityRole="button"
          accessibilityLabel={held.action.label}
          style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}>
          <Text style={styles.actionLabel}>{held.action.label}</Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onUndo}
        accessibilityRole="button"
        accessibilityLabel="Undo"
        style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}>
        <Text style={styles.undoLabel}>Undo</Text>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    position: 'absolute',
    left: screenPadding,
    right: screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 48,
    borderRadius: radius.pill,
    // The one pairing in the palette that inverts between themes, which is what a bar
    // sitting on top of the feed needs — it has to read as above the page in both.
    backgroundColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  message: {
    flex: 1,
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.accentText,
  },
  button: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.6,
  },
  // The suggestion is lighter than the undo on purpose: it is the one that leaves the feed.
  actionLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.accentText,
    opacity: 0.75,
  },
  undoLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.accentText,
  },
}));
