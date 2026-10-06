import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { EASE_DRIFT, seeded, usePaywallColors, type PaywallPalette } from './palette';

interface BlobSpec {
  color: keyof Pick<PaywallPalette, 'violet' | 'magenta' | 'blue'>;
  size: number;
  /** Resting centre, as a fraction of the screen. */
  x: number;
  y: number;
  /** How far it wanders, in points. */
  drift: number;
  duration: number;
  opacity: number;
}

const BLOBS: BlobSpec[] = [
  { color: 'violet', size: 1.25, x: 0.2, y: 0.12, drift: 60, duration: 11000, opacity: 0.75 },
  { color: 'magenta', size: 1.0, x: 0.95, y: 0.3, drift: 70, duration: 13000, opacity: 0.45 },
  { color: 'blue', size: 1.1, x: 0.1, y: 0.62, drift: 50, duration: 15000, opacity: 0.4 },
];

/**
 * Slow light behind the paywall: three soft blobs that drift and breathe, and a field of
 * stars that twinkle. Transform and opacity only, every loop on the UI thread, and all of it
 * holds still under Reduce Motion.
 */
export function AuroraBackground() {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const c = usePaywallColors();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} />
      {BLOBS.map((blob, index) => (
        <Blob key={index} spec={blob} color={c[blob.color]} strength={c.blobOpacity} index={index} width={width} height={height} still={reduced} />
      ))}
      <Stars width={width} height={height} still={reduced} color={c.star} peak={c.starPeak} />
      {/* Darkens the bottom third, where the plans and price have to read. */}
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
        <Defs>
          <RadialGradient id="vignette" cx="50%" cy="10%" rx="110%" ry="95%">
            <Stop offset="0.45" stopColor={c.background} stopOpacity="0" />
            <Stop offset="1" stopColor={c.background} stopOpacity="0.92" />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#vignette)" />
      </Svg>
    </View>
  );
}

function Blob({
  spec,
  color,
  strength,
  index,
  width,
  height,
  still,
}: {
  spec: BlobSpec;
  color: string;
  strength: number;
  index: number;
  width: number;
  height: number;
  still: boolean;
}) {
  const size = width * spec.size;
  const t = useSharedValue(0);

  useEffect(() => {
    if (still) return;
    t.set(withRepeat(withTiming(1, { duration: spec.duration, easing: EASE_DRIFT }), -1, true));
  }, [still, spec.duration, t]);

  // Each blob traces its own lazy loop: different phase per axis, so they never sync up.
  const style = useAnimatedStyle(() => {
    const p = t.get();
    const angle = p * Math.PI * 2 + index * 2.1;
    return {
      transform: [
        { translateX: Math.cos(angle) * spec.drift },
        { translateY: Math.sin(angle * 0.5) * spec.drift },
        { scale: 1 + Math.sin(angle) * 0.08 },
      ],
    };
  });

  const id = `blob${index}`;
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          left: width * spec.x - size / 2,
          top: height * spec.y - size / 2,
          opacity: spec.opacity * strength,
        },
        style,
      ]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity="0.9" />
            <Stop offset="0.45" stopColor={color} stopOpacity="0.35" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const STAR_COUNT = 26;

function Stars({
  width,
  height,
  still,
  color,
  peak,
}: {
  width: number;
  height: number;
  still: boolean;
  color: string;
  peak: number;
}) {
  const stars = useMemo(() => {
    const random = seeded(7);
    return Array.from({ length: STAR_COUNT }, () => ({
      x: random() * width,
      // Kept to the top half: the plans below should sit on calm ground.
      y: random() * height * 0.55,
      size: 1 + random() * 2.2,
      delay: random() * 3000,
      duration: 1400 + random() * 2200,
    }));
  }, [width, height]);

  return (
    <>
      {stars.map((star, index) => (
        <Star key={index} {...star} still={still} color={color} peak={peak} />
      ))}
    </>
  );
}

function Star({
  x,
  y,
  size,
  delay,
  duration,
  still,
  color,
  peak,
}: {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  still: boolean;
  color: string;
  peak: number;
}) {
  const opacity = useSharedValue(still ? 0.5 : 0);

  useEffect(() => {
    if (still) return;
    opacity.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(peak, { duration, easing: EASE_DRIFT }),
            withTiming(0.15, { duration, easing: EASE_DRIFT }),
          ),
          -1,
        ),
      ),
    );
  }, [still, delay, duration, opacity, peak]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}
