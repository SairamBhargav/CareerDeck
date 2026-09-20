import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { SkillChip } from '@/components/common/SkillChip';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { ReelActionRail } from '@/components/reels/ReelActionRail';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Job } from '@/types';
import { hexToRgba } from '@/utils/color';
import { formatPostedAt } from '@/utils/format';

const MAX_SKILL_CHIPS = 6;
/** Width reserved on the right so caption text never runs under the action rail. */
const RAIL_RESERVED_WIDTH = 92;
/** Lifts the action rail (and Read more, which stays level with it) off the very bottom edge. */
const RAIL_LIFT = spacing.sm;
/** Extra breathing room between the end of the caption and the rail line, on top of RAIL_LIFT. */
const CONTENT_BOTTOM_GAP = spacing.xl;
/** Must match `description`'s own lineHeight — it's what one clamped line gives back. */
const DESCRIPTION_LINE_HEIGHT = 22;
/** Never clamp the blurb below this, however tight the card gets. */
const MIN_DESCRIPTION_LINES = 2;

interface JobReelCardProps {
  job: Job;
  /** Exact height of one page so paging lands on card boundaries. */
  height: number;
  /** Space reserved for the feed toggle above and the tab bar below. */
  paddingTop: number;
  paddingBottom: number;
  logoColor?: string;
  /** Company's real logo image, when available — falls back to job.companyLogo's monogram. */
  logoUrl?: string;
  commentCount: number;
  onLike: () => void;
  onComment: () => void;
  onMore: () => void;
  onAutoApply: () => void;
}

export function JobReelCard({
  job,
  height,
  paddingTop,
  paddingBottom,
  logoColor,
  logoUrl,
  commentCount,
  onLike,
  onComment,
  onMore,
  onAutoApply,
}: JobReelCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const skills = job.skills.slice(0, MAX_SKILL_CHIPS);
  // How tall the caption's box actually is: the rail's own lift, plus extra room so the
  // text visibly stops short of the rail line instead of running right up to it.
  const availableContentHeight = height - paddingTop - paddingBottom - RAIL_LIFT - CONTENT_BOTTOM_GAP;

  // Both measured on the first, unclamped pass and then frozen: clamping the blurb
  // shrinks the caption, which would otherwise re-fire these and oscillate. "Read more"
  // renders on every card, so it's already inside `content` — the overflow is exactly
  // what the description owes back, with nothing further to reserve.
  const [natural, setNatural] = useState<{ content: number; description: number } | null>(null);
  const measured = useRef<{ content?: number; description?: number }>({});

  const overflowBy = natural === null ? 0 : natural.content - availableContentHeight;

  // Trim the blurb by exactly that, so the skill chips below it always land whole
  // instead of being sliced by the clipping box. Left alone when the copy already fits.
  const descriptionLines =
    natural !== null && overflowBy > 0
      ? Math.max(
          MIN_DESCRIPTION_LINES,
          Math.floor((natural.description - overflowBy) / DESCRIPTION_LINE_HEIGHT),
        )
      : undefined;

  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  // Single tap on the rail heart and double-tap-anywhere both funnel through this, so
  // haptics and the toggle itself only need to be wired up in one place.
  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLike();
  };

  const playHeartBurst = () => {
    heartScale.value = 0.4;
    heartOpacity.value = 1;
    heartScale.value = withSequence(withSpring(1.15, { damping: 7, stiffness: 220 }), withSpring(1, { damping: 10 }));
    heartOpacity.value = withSequence(withTiming(1, { duration: 60 }), withTiming(1, { duration: 300 }), withTiming(0, { duration: 250 }));
  };

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (success) {
        runOnJS(handleLike)();
        runOnJS(playHeartBurst)();
      }
    });

  const heartBurstStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [{ scale: heartScale.value }],
  }));

  // Each half arrives in its own layout pass; commit once both have, and only the first
  // time, so the frozen numbers describe unclamped copy.
  const capture = (key: 'content' | 'description') => (event: LayoutChangeEvent) => {
    const measurement = event.nativeEvent.layout.height;
    if (measurement <= 0 || measured.current[key] !== undefined) return;

    measured.current[key] = measurement;
    const { content, description } = measured.current;
    if (content !== undefined && description !== undefined) setNatural({ content, description });
  };

  return (
    <View style={[styles.page, { height, paddingTop, paddingBottom }]}>
      {/* A soft full-bleed wash of the company's brand color, plus a stronger accent
          glow behind the logo — gives each reel its own identity without a loud gradient.
          Both alphas come from the palette: over a near-black page the light-mode values
          would be invisible, so dark leans on the brand colour far harder. */}
      <View
        pointerEvents="none"
        style={[
          styles.wash,
          logoColor ? { backgroundColor: hexToRgba(logoColor, colors.reelWashAlpha) } : null,
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          logoColor ? { backgroundColor: hexToRgba(logoColor, colors.reelGlowAlpha) } : null,
        ]}
      />

      <GestureDetector gesture={doubleTap}>
        <View style={styles.tapZone}>
          <View
            style={[
              styles.contentBox,
              { paddingRight: RAIL_RESERVED_WIDTH, paddingBottom: RAIL_LIFT + CONTENT_BOTTOM_GAP },
            ]}>
            {/* Free to size to its content on the first pass, which is what lets onLayout
                report the true un-clamped height. contentBox's fixed height still clips
                that pass; once the description is clamped, everything fits inside it. */}
            <View style={styles.contentInner} onLayout={capture('content')}>
              <View style={styles.companyRow}>
                <CompanyLogo logo={logoUrl ?? job.companyLogo} name={job.companyName} color={logoColor} size="md" />
                <View style={styles.companyText}>
                  <Text style={styles.companyName} numberOfLines={1}>
                    {job.companyName}
                  </Text>
                  <Text style={styles.posted}>{formatPostedAt(job.postedAt)}</Text>
                </View>
              </View>

              <Text style={styles.title}>{job.title}</Text>

              <JobMetadata job={job} emphasizeSalary />

              <View style={styles.descriptionBlock}>
                <Text
                  style={styles.description}
                  numberOfLines={descriptionLines}
                  onLayout={capture('description')}>
                  {job.description}
                </Text>

                {/* On every card, not just clamped ones: the sheet always carries the
                    full requirements list, which the reel never shows at all. */}
                <Pressable
                  onPress={onMore}
                  accessibilityRole="button"
                  accessibilityLabel={'Read the full posting for ' + job.title}
                  hitSlop={8}
                  style={({ pressed }) => [styles.readMore, pressed ? styles.readMorePressed : null]}>
                  <Text style={styles.readMoreLabel}>Read more</Text>
                  <Ionicons name="chevron-down" size={11} color={colors.text} />
                </Pressable>
              </View>

              <View style={styles.skills}>
                {skills.map((skill) => (
                  <SkillChip key={skill} label={skill} />
                ))}
              </View>
            </View>
          </View>

          <Animated.View pointerEvents="none" style={[styles.heartBurst, heartBurstStyle]}>
            <Ionicons name="heart" size={104} color={colors.like} />
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={[styles.rail, { bottom: paddingBottom + RAIL_LIFT }]}>
        <ReelActionRail
          isLiked={job.isLiked}
          commentCount={commentCount}
          onLike={handleLike}
          onComment={onComment}
          onMore={onMore}
          onAutoApply={onAutoApply}
          jobTitle={job.title}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  page: {
    width: '100%',
    paddingHorizontal: screenPadding,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  tapZone: {
    flex: 1,
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.backgroundMuted,
  },
  glow: {
    position: 'absolute',
    top: -160,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: radius.pill,
    // Pre-blended fallback for the rare case a job's company has no brand color; the
    // inline style above overrides this with the real tint.
    backgroundColor: colors.reelGlowFallback,
  },
  // Top-anchored (never centered) so every reel's caption starts at the same spot
  // regardless of description length, and hard-clipped at the bottom so it can grow to
  // fill all the way down to the action rail without ever running past it.
  contentBox: {
    flex: 1,
    overflow: 'hidden',
  },
  contentInner: {
    gap: spacing.md,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  companyText: {
    flex: 1,
  },
  companyName: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  posted: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  title: {
    fontSize: fontSize.hero,
    lineHeight: 39,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
  },
  description: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  skills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  // Kept tight to the blurb it continues, with less air than contentInner's own gap.
  descriptionBlock: {
    gap: spacing.xs,
  },
  // Part of the caption rather than a control floating over it: no pill, no border, no
  // shadow — just the one line of the copy that happens to be tappable, which is why it
  // takes the full-strength text colour the body copy around it doesn't.
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
  },
  readMorePressed: {
    opacity: 0.7,
  },
  readMoreLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  heartBurst: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    right: screenPadding,
  },
}));
