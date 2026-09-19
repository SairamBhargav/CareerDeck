import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
/** The document mark above the figure — small enough to read as a unit label, not an icon button. */
const GLYPH_SIZE = 11;
const STROKE_WIDTH = 5;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

// Fixed rather than themed, so a given score reads the same in light and dark.
// Worth revisiting: red/amber/green is borrowed from status indicators, where red means
// something is wrong. A low match isn't a fault — it's a different fit — so this palette
// editorializes more than the score behind it can currently justify.
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
 *
 * A bare ring around a percentage is the same shape as a battery or storage gauge, so
 * the document mark and the word underneath are doing the real work here: they say the
 * figure is a percentage *of a resume against this posting*, not a level of something
 * filling up.
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
      <View style={styles.ring}>
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

        <Ionicons name="document-text" size={GLYPH_SIZE} color={colors.textSecondary} style={styles.glyph} />
        <Text style={styles.label}>{label}%</Text>
      </View>

      <Text style={styles.caption}>MATCH</Text>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The badge is absolutely positioned by its top edge in Reels, so growing downward to
  // fit the caption leaves the ring itself aligned with the feed toggle beside it.
  wrap: {
    width: SIZE,
    alignItems: 'center',
  },
  ring: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    // Pulled tight to the figure so the two read as one stacked unit rather than an
    // icon that happens to sit above a number.
    marginBottom: -1,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 0 },
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
  caption: {
    marginTop: 3,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: colors.textSecondary,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 0 },
  },
}));
