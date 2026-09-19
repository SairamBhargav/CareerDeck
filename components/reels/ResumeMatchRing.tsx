import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { fontSize } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const SIZE = 56;
const STROKE_WIDTH = 5;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

// Fixed, not themed — a match score is a semantic red/amber/green signal, the same
// language as a battery or signal indicator, and it needs to read the same way
// regardless of light or dark mode.
const POOR_COLOR = '#FF5A5F';
const FAIR_COLOR = '#F5A623';
const GOOD_COLOR = '#3DD16F';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ResumeMatchRingProps {
  /** 0-100. Update continuously (e.g. from scroll) for the "cool" morphing effect. */
  progress: SharedValue<number>;
}

/**
 * Top-right badge on Reels: how well the user's default resume matches the job
 * currently on screen. Floats directly on the reel — no plate or chip behind it — since
 * the ring already carries its own weight and colour; a solid backing just reads as a
 * stray white (or dark) disc sitting on top of the company wash.
 */
export function ResumeMatchRing({ progress }: ResumeMatchRingProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  // A one-time pop-in on mount, independent of the live `progress` feed so the ring
  // doesn't appear already fully drawn the instant the screen mounts.
  const mount = useSharedValue(0);
  useEffect(() => {
    mount.value = withSpring(1, { damping: 13, stiffness: 160 });
  }, [mount]);

  // The number in the middle. Reacts to the same shared value the ring draws from,
  // but only pushes a JS state update when the rounded percentage actually changes —
  // otherwise a fast scroll would fire a React re-render on every single frame.
  const [label, setLabel] = useState(() => Math.round(progress.value));
  useAnimatedReaction(
    () => Math.round(Math.min(Math.max(progress.value, 0), 100)),
    (current, previous) => {
      if (current !== previous) runOnJS(setLabel)(current);
    },
    [],
  );

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: mount.value,
    transform: [{ scale: interpolate(mount.value, [0, 1], [0.5, 1]) }],
  }));

  const ringProps = useAnimatedProps(() => {
    const clamped = Math.min(Math.max(progress.value, 0), 100);
    return {
      strokeDashoffset: CIRCUMFERENCE * (1 - clamped / 100),
      stroke: interpolateColor(progress.value, [0, 50, 100], [POOR_COLOR, FAIR_COLOR, GOOD_COLOR]),
    };
  });

  return (
    <Animated.View style={[styles.wrap, entranceStyle]}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Circle cx={CENTER} cy={CENTER} r={RADIUS} stroke={colors.border} strokeWidth={STROKE_WIDTH} fill="none" />
        <AnimatedCircle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE}, ${CIRCUMFERENCE}`}
          rotation={-90}
          origin={`${CENTER}, ${CENTER}`}
          animatedProps={ringProps}
        />
      </Svg>
      <Text style={styles.label}>{label}%</Text>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
    // A soft dark shadow behind the text substitutes for the backing plate's contrast —
    // keeps the percentage legible over a light wash without a shape behind the ring.
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 0 },
  },
}));
