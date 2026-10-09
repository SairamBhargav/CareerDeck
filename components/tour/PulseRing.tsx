import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { usePaywallColors } from '@/components/paywall/palette';

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius of the thing being pointed at; a pill when omitted. */
  radius?: number;
}

const OUTSET = 6;

/**
 * The tour's "tap here": a steady ring around the target and a second one breathing out of it.
 *
 * Drawn in Auto Apply's violet, the one colour the tour owns. Never takes a touch, so the real
 * control underneath stays the thing that is tapped.
 */
export function PulseRing({ rect }: { rect: WindowRect }) {
  const pro = usePaywallColors();
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    t.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [reduceMotion, t]);

  const breath = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - t.value),
    transform: [{ scale: 1 + t.value * 0.28 }],
  }));

  const radius = (rect.radius ?? Math.min(rect.width, rect.height) / 2) + OUTSET;
  const box = {
    left: rect.x - OUTSET,
    top: rect.y - OUTSET,
    width: rect.width + OUTSET * 2,
    height: rect.height + OUTSET * 2,
  };

  return (
    <View pointerEvents="none" style={[styles.box, box]}>
      <View style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: radius, borderColor: pro.violet }]} />
      {reduceMotion ? null : (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: radius, borderColor: pro.violet }, breath]}
        />
      )}
    </View>
  );
}

/**
 * Where a view sits on screen, for pointing a ring at it. The tour screen is full-screen, so
 * window coordinates are its own.
 */
export function useWindowRect() {
  // A callback ref held in state rather than `useRef`, so nothing reads a ref during render.
  const [node, setNode] = useState<View | null>(null);
  const [rect, setRect] = useState<WindowRect | null>(null);

  const onLayout = useCallback(() => {
    // After layout settles: measuring inside the callback itself can report the pre-layout frame.
    requestAnimationFrame(() => {
      node?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) setRect({ x, y, width, height });
      });
    });
  }, [node]);

  return { attach: setNode, rect, onLayout };
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
  },
  ring: {
    borderWidth: 2,
  },
});
