import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { seeded, usePaywallColors } from './palette';

const COUNT = 70;
const GRAVITY = 1400;

/**
 * The celebration when Pro switches on: a burst from the top centre that arcs under gravity
 * and fades. Rare tier, once per purchase, so it gets the full budget. Mount it to fire it.
 * Reduce Motion skips it; the "You're on Pro" state says the same thing without it.
 */
export function Confetti() {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const c = usePaywallColors();

  const pieces = useMemo(() => {
    const COLORS = [c.violetText, c.magenta, c.gold, c.blue, c.confettiNeutral, c.success];
    const random = seeded(42);
    return Array.from({ length: COUNT }, () => {
      const angle = -Math.PI / 2 + (random() - 0.5) * Math.PI * 1.1;
      const speed = 520 + random() * 620;
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: (random() - 0.5) * 1440,
        color: COLORS[Math.floor(random() * COLORS.length)] ?? c.violet,
        w: 6 + random() * 6,
        h: 8 + random() * 10,
        delay: random() * 120,
        duration: 1700 + random() * 900,
      };
    });
  }, [c]);

  if (reduced) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((piece, index) => (
        <Piece key={index} {...piece} originX={width / 2} />
      ))}
    </View>
  );
}

function Piece({
  vx,
  vy,
  spin,
  color,
  w,
  h,
  delay,
  duration,
  originX,
}: {
  vx: number;
  vy: number;
  spin: number;
  color: string;
  w: number;
  h: number;
  delay: number;
  duration: number;
  originX: number;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.set(withDelay(delay, withTiming(1, { duration, easing: Easing.linear })));
  }, [delay, duration, t]);

  const style = useAnimatedStyle(() => {
    const s = (t.get() * duration) / 1000;
    // Air drag on the horizontal, so pieces drift rather than fly in straight lines.
    const x = vx * s * (1 - t.get() * 0.45);
    const y = vy * s + 0.5 * GRAVITY * s * s;
    return {
      opacity: t.get() === 0 ? 0 : 1 - Math.max(0, (t.get() - 0.7) / 0.3),
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${spin * s}deg` },
        // A flat piece of paper turning over: width oscillates through zero.
        { scaleX: Math.cos(s * 9 + vx) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        { position: 'absolute', left: originX - w / 2, top: 140, width: w, height: h, borderRadius: 2, backgroundColor: color },
        style,
      ]}
    />
  );
}
