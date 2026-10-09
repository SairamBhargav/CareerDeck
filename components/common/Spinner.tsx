import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { usePaywallColors } from '@/components/paywall/palette';

/** One turn. Slow enough to read as deliberate rather than frantic. */
const SPIN_MS = 900;

interface SpinnerProps {
  size?: number;
  /** Stroke width. Scales with size unless given. */
  stroke?: number;
}

/**
 * The ring without the rotation.
 *
 * Separate because the Deck's pull indicator already owns a rotation — it drives one
 * shared value for the whole refresh gesture, including the wind-up as the finger pulls —
 * and dropping a self-spinning component inside that would turn twice.
 */
export function SpinnerRing({ size = 24, stroke }: SpinnerProps) {
  const c = usePaywallColors();
  const width = stroke ?? Math.max(2, Math.round(size / 10));
  const radius = (size - width) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <Svg width={size} height={size}>
      <Defs>
        <LinearGradient id="spinnerArc" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={c.violet} stopOpacity="0" />
          <Stop offset="0.5" stopColor={c.magenta} stopOpacity="0.9" />
          <Stop offset="1" stopColor={c.gold} stopOpacity="1" />
        </LinearGradient>
      </Defs>

      {/* The track the arc runs on. Faint, so the ring reads as a complete shape rather
          than the arc floating in space. */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={c.violet}
        strokeOpacity={0.16}
        strokeWidth={width}
        fill="none"
      />

      {/* Three quarters of the circumference dashed away leaves a quarter-turn arc. */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="url(#spinnerArc)"
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={`${circumference * 0.26} ${circumference}`}
        fill="none"
      />
    </Svg>
  );
}

/**
 * A ring with a bright arc travelling round it.
 *
 * Replaces `ActivityIndicator`, which is the platform's grey pinwheel and belongs to no
 * app in particular. This borrows the Pro card's beam — violet into magenta into gold —
 * so the one piece of chrome a reader stares at while waiting is recognisably ours.
 *
 * ── Why an SVG rather than a bordered View ───────────────────────────────────
 *
 * The usual trick is a circle with three transparent borders and one coloured, spun. That
 * gives a quarter-arc with hard square ends and no way to fade the tail, which is most of
 * what makes a spinner look cheap. A stroked circle with a dash pattern gives a real arc
 * with round caps, and a gradient along it fades the tail into the track.
 */
export function Spinner({ size = 24, stroke }: SpinnerProps) {
  const turn = useSharedValue(0);

  useEffect(() => {
    turn.set(withRepeat(withTiming(360, { duration: SPIN_MS, easing: Easing.linear }), -1, false));
    // Stops the animation when the spinner unmounts, which for a list footer is every time
    // a page finishes arriving.
    return () => cancelAnimation(turn);
  }, [turn]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading">
      <Animated.View style={style}>
        <SpinnerRing size={size} stroke={stroke} />
      </Animated.View>
    </View>
  );
}
