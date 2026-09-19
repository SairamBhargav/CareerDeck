import { useState } from 'react';
import { type TextStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useDerivedValue, withTiming } from 'react-native-reanimated';

/** Long enough to see the number travel, short enough that the page isn't still settling. */
const COUNT_MS = 600;

interface AnimatedCountProps {
  value: number;
  style?: TextStyle | TextStyle[];
}

/**
 * A figure that counts up to its value instead of appearing at it.
 *
 * The tween runs on the UI thread and only pushes a React update when the *rounded*
 * number changes, so a count to 12 re-renders twelve times rather than once a frame.
 */
export function AnimatedCount({ value, style }: AnimatedCountProps) {
  const [shown, setShown] = useState(0);

  const progress = useDerivedValue(() => withTiming(value, { duration: COUNT_MS }), [value]);

  useAnimatedReaction(
    () => Math.round(progress.value),
    (current, previous) => {
      if (current !== previous) runOnJS(setShown)(current);
    },
    [],
  );

  return <Animated.Text style={style}>{shown}</Animated.Text>;
}
