import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/** Points per second. Slow on purpose — this is something to read, not an effect. */
const DEFAULT_SPEED = 26;
/** Held still at each end, so the start and the end are both legible before it moves. */
const DEFAULT_PAUSE_MS = 1100;

interface MarqueeTextProps {
  children: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  speed?: number;
  pauseMs?: number;
}

/**
 * One line of text that scrolls itself when it does not fit.
 *
 * Resume names are long and not chosen for display — "Resume - Bhargav Sairam v1.docx (1)" is
 * what a file manager produced, and every part of it after the name is the part a truncating
 * label throws away. Wrapping it instead is worse in a narrow tile: two cramped lines that
 * still end in an ellipsis.
 *
 * So it stays on one line and travels. It sits still, slides left far enough to bring the end
 * into view, holds, and comes back — which reads the whole string without the jarring reset of
 * a looping ticker, and costs nothing when the text already fits.
 *
 * ── How the width is known ────────────────────────────────────────────────────
 *
 * A `Text` inside a fixed-width parent is laid out at the parent's width, so its own
 * `onLayout` cannot report how wide the string *wants* to be. The hidden copy below is
 * measured inside a deliberately over-wide absolute box, where nothing constrains it, and that
 * is the only place the natural width exists. It is `aria-hidden` so screen readers see the
 * string once, not twice.
 *
 * Reduced motion turns the travel off entirely and leaves a plain truncated line — a label
 * that moves on its own is exactly what that setting is asking not to happen.
 */
export function MarqueeText({
  children,
  style,
  containerStyle,
  speed = DEFAULT_SPEED,
  pauseMs = DEFAULT_PAUSE_MS,
}: MarqueeTextProps) {
  const reducedMotion = useReducedMotion();
  const [boxWidth, setBoxWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const offset = useSharedValue(0);

  // A point of slack: sub-pixel measurement differences should not start a 0.4pt crawl.
  const overflow = Math.max(0, Math.round(textWidth - boxWidth));
  // `boxWidth > 0` guards the first frame, where the container has not been measured yet and
  // every string would otherwise look like it overflowed by its entire width.
  const travels = boxWidth > 0 && overflow > 1 && !reducedMotion;

  useEffect(() => {
    if (!travels) {
      cancelAnimation(offset);
      offset.value = 0;
      return;
    }

    const duration = (overflow / speed) * 1000;

    offset.value = 0;
    offset.value = withRepeat(
      withSequence(
        // Out to the end, hold, back to the start, hold. The delays are attached to the
        // *following* leg so the first pause happens before the first movement.
        withDelay(pauseMs, withTiming(-overflow, { duration, easing: Easing.linear })),
        withDelay(pauseMs, withTiming(0, { duration, easing: Easing.linear })),
      ),
      -1,
    );

    return () => cancelAnimation(offset);
  }, [travels, overflow, speed, pauseMs, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View
      style={[styles.clip, containerStyle]}
      onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}>
      {/*
        The measuring copy. Over-wide box, absolutely positioned and invisible, so the text
        reports the width it actually wants rather than the width it was given.
      */}
      <View style={styles.measure} pointerEvents="none" aria-hidden>
        <Text
          style={style}
          numberOfLines={1}
          onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)}>
          {children}
        </Text>
      </View>

      {/*
        The explicit width is load-bearing, not a hint.

        Yoga caps a child at its parent's cross-axis size, so without it this `Text` is laid out
        at the container's width and simply truncates — there would be nothing beyond the edge
        for `translateX` to reveal, and the animation would run against a string that had
        already been cut. An explicit width larger than the parent is honoured and overflows,
        which `overflow: hidden` above then clips back to the tile.
      */}
      <Animated.Text
        style={[style, styles.line, textWidth > 0 ? { width: textWidth } : null, animatedStyle]}
        numberOfLines={1}
        // Truncation only matters when it is standing still; while travelling the whole
        // string is reachable, and an ellipsis mid-scroll would be a lie.
        ellipsizeMode={travels ? 'clip' : 'tail'}>
        {children}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    // Wider than any label this is used for, which is what frees the measurement.
    width: 4000,
    opacity: 0,
  },
  line: {
    // Never shrink to the container: shrinking is what turns travel into truncation.
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
});
