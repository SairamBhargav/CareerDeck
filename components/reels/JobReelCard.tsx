import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
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
  onLike: () => void;
  onMore: () => void;
  onAutoApply: () => void;
  autoApplyCredits: number;
}

export function JobReelCard({
  job,
  height,
  paddingTop,
  paddingBottom,
  logoColor,
  logoUrl,
  onLike,
  onMore,
  onAutoApply,
  autoApplyCredits,
}: JobReelCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const skills = job.skills.slice(0, MAX_SKILL_CHIPS);
  // How tall the caption's box actually is: the rail's own lift, plus extra room so the
  // text visibly stops short of the rail line instead of running right up to it.
  const availableContentHeight = height - paddingTop - paddingBottom - RAIL_LIFT - CONTENT_BOTTOM_GAP;

  // The un-clipped content's own natural height, measured via onLayout on the inner
  // wrapper below. Compared against the available (clipped) box to decide whether this
  // job's copy actually needs "Read more" or comfortably fits on its own.
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);
  const needsReadMore = naturalHeight !== null && naturalHeight > availableContentHeight;

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

  const handleContentLayout = (event: LayoutChangeEvent) => {
    setNaturalHeight(event.nativeEvent.layout.height);
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
            {/* Unconstrained on purpose: contentBox's fixed height + overflow:hidden is
                what visually clips this, but leaving this view free to size to its natural
                content means onLayout reports the true, un-clipped height. */}
            <View style={styles.contentInner} onLayout={handleContentLayout}>
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

              <Text style={styles.description}>{job.description}</Text>

              <View style={styles.skills}>
                {skills.map((skill) => (
                  <SkillChip key={skill} label={skill} />
                ))}
              </View>
            </View>
          </View>

          {needsReadMore ? (
            <Pressable
              onPress={onMore}
              accessibilityRole="button"
              accessibilityLabel="Read the full job description"
              style={({ pressed }) => [
                styles.readMore,
                { bottom: RAIL_LIFT + CONTENT_BOTTOM_GAP },
                pressed ? styles.readMorePressed : null,
              ]}>
              <Text style={styles.readMoreLabel}>Read more</Text>
              <Ionicons name="chevron-down" size={11} color={colors.text} />
            </Pressable>
          ) : null}

          <Animated.View pointerEvents="none" style={[styles.heartBurst, heartBurstStyle]}>
            <Ionicons name="heart" size={104} color={colors.like} />
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={[styles.rail, { bottom: paddingBottom + RAIL_LIFT }]}>
        <ReelActionRail
          isLiked={job.isLiked}
          onLike={handleLike}
          onMore={onMore}
          onAutoApply={onAutoApply}
          jobTitle={job.title}
          autoApplyCredits={autoApplyCredits}
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
  // Pinned to the bottom of the tapZone (lifted the same amount as the rail), which
  // already sits at the same Y as the action rail's bottom — so this lines up with the
  // bottom of the Auto Apply button without any extra math.
  readMore: {
    position: 'absolute',
    left: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.controlSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...colors.shadowSoft,
  },
  readMorePressed: {
    opacity: 0.7,
  },
  readMoreLabel: {
    fontSize: fontSize.caption,
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
