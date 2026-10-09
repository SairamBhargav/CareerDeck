import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/context/ThemeContext';

/** Big enough to read as a reaction rather than an icon, small enough that several overlap
 *  without becoming a wall of red. */
const SIZE = 88;

/** How far it drifts up over its life. */
const LIFT = 46;

const IN_MS = 60;
const HOLD_MS = 260;
const OUT_MS = 260;

export interface LikeBurstProps {
  /** Where the fingers landed, relative to the tap area. */
  x: number;
  y: number;
  /** A few degrees either side of upright, so a stack of them does not look stamped. */
  tilt: number;
  /** Fired once the heart has finished, so the caller can drop it from its list. */
  onDone: () => void;
}

/**
 * One heart, where the reader double-tapped.
 *
 * Mounted per tap rather than replayed, which is the whole point: tapping again while one
 * is still rising adds a second instead of restarting the first. Each owns its own shared
 * values, lives for about half a second, and then asks to be removed — so the cost of the
 * effect is bounded by how fast somebody can tap rather than accumulating.
 */
export function LikeBurst({ x, y, tilt, onDone }: LikeBurstProps) {
  const { colors } = useTheme();

  const scale = useSharedValue(0.4);
  const opacity = useSharedValue(0);
  const lift = useSharedValue(0);

  useEffect(() => {
    scale.set(
      withSequence(withSpring(1.15, { damping: 7, stiffness: 220 }), withSpring(1, { damping: 10 })),
    );
    lift.set(withTiming(-LIFT, { duration: IN_MS + HOLD_MS + OUT_MS, easing: Easing.out(Easing.quad) }));
    opacity.set(
      withSequence(
        withTiming(1, { duration: IN_MS }),
        withTiming(1, { duration: HOLD_MS }),
        // The last animation to finish owns the cleanup, so the heart is unmounted exactly
        // once and only after it is actually invisible.
        withTiming(0, { duration: OUT_MS }, (finished) => {
          if (finished) runOnJS(onDone)();
        }),
      ),
    );
  }, [scale, opacity, lift, onDone]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }, { scale: scale.value }, { rotate: `${tilt}deg` }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      // Centred on the touch rather than hung from its corner.
      style={[styles.heart, { left: x - SIZE / 2, top: y - SIZE / 2 }, style]}>
      <Ionicons name="heart" size={SIZE} color={colors.like} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heart: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
