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

/**
 * Exported because Reels positions the badge against this number. Keeping one copy is
 * what stops the screen's centring maths drifting away from the ring it's centring.
 */
export const MATCH_RING_SIZE = 48;

const STROKE_WIDTH = 4.5;
const RADIUS = (MATCH_RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = MATCH_RING_SIZE / 2;

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
  /**
   * What the number is made of, for the posting currently on screen — §3.10's `components`.
   *
   * Drives the caption under the ring. Phase 3 and earlier this said "MATCH" unconditionally,
   * which was the honest label for a hash of two ids. Now that there is a real calculation
   * behind it, the caption says which part of it is carrying the score.
   */
  explain?: MatchExplanation | null;
}

export interface MatchExplanation {
  skillOverlap?: number;
  seniority?: number;
  location?: number;
  /** 0-1. How much of the formula had an input at all. */
  coverage: number;
}

/**
 * Top-right badge on Reels: how well the user's default resume matches the job
 * currently on screen. Floats directly on the reel — no plate or chip behind it — since
 * the ring already carries its own weight and colour; a solid backing just reads as a
 * stray white (or dark) disc sitting on top of the company wash.
 *
 * A bare ring around a percentage is the same shape as a battery or storage gauge, so
 * the word underneath is doing the real work: it says the figure is a percentage *of a
 * resume against this posting*, not a level of something filling up.
 */
export function ResumeMatchRing({ progress, explain }: ResumeMatchRingProps) {
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
        <Svg width={MATCH_RING_SIZE} height={MATCH_RING_SIZE} style={StyleSheet.absoluteFill}>
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
      </View>

      <Text style={styles.caption} numberOfLines={1}>
        {captionFor(explain)}
      </Text>
    </Animated.View>
  );
}

/**
 * One word for why the number is what it is — §13.3's "keeping `components` explainable isn't
 * only a UX nicety".
 *
 * The full sentence §3.10 imagines ("strong skills match, but they want 3 years") needs room
 * this badge does not have, so this is the one-word version: the component doing the most work.
 * It is a deliberate step short of the eventual design and a long step past "MATCH", which is
 * what a ring over a hash function was entitled to say.
 *
 * `THIN` is the case worth having: a posting that lists no skills is scored on seniority and
 * location alone and renormalized, so it can read 90 on a quarter of the formula. Saying so is
 * the difference between a confident number and a number that looks confident.
 */
function captionFor(explain: MatchExplanation | null | undefined): string {
  if (!explain) return 'MATCH';
  if (explain.coverage < 0.6) return 'PARTIAL';

  const candidates: { label: string; value: number | undefined }[] = [
    { label: 'SKILLS', value: explain.skillOverlap },
    { label: 'LEVEL', value: explain.seniority },
    { label: 'PLACE', value: explain.location },
  ];

  let best: { label: string; value: number } | null = null;
  for (const candidate of candidates) {
    if (typeof candidate.value !== 'number') continue;
    if (best === null || candidate.value > best.value) {
      best = { label: candidate.label, value: candidate.value };
    }
  }

  // Nothing scored well enough to be the reason. "MATCH" is then the honest caption: the
  // number is a blend of three mediocre things rather than one good one.
  return best !== null && best.value >= 0.6 ? best.label : 'MATCH';
}

const useStyles = makeStyles((colors) => ({
  // The badge is absolutely positioned by its top edge in Reels, so growing downward to
  // fit the caption leaves the ring itself aligned with the feed toggle beside it.
  wrap: {
    width: MATCH_RING_SIZE,
    alignItems: 'center',
  },
  ring: {
    width: MATCH_RING_SIZE,
    height: MATCH_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No text shadow on either of these. A soft dark halo was standing in for a backing
  // plate, but at this size it fattens the strokes into a smudge instead of lifting the
  // text — the reel's own background is close enough to the page that the palette's
  // contrast carries it on its own.
  label: {
    // With the glyph gone the ring still has room for a figure you can read at a glance.
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  caption: {
    marginTop: 2,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.textSecondary,
  },
}));
