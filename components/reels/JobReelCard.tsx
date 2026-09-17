import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { colors, fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import type { Job } from '@/types';
import { formatPostedAt } from '@/utils/format';

const DESCRIPTION_COLLAPSED_LINES = 4;
const MAX_SKILL_CHIPS = 4;
/** Width reserved on the right so caption text never runs under the action rail. */
const RAIL_RESERVED_WIDTH = 92;

interface JobReelCardProps {
  job: Job;
  /** Exact height of one page so paging lands on card boundaries. */
  height: number;
  /** Space reserved for the feed toggle above and the tab bar below. */
  paddingTop: number;
  paddingBottom: number;
  logoColor?: string;
  onLike: () => void;
  onMore: () => void;
  onAutoApply: () => void;
}

export function JobReelCard({
  job,
  height,
  paddingTop,
  paddingBottom,
  logoColor,
  onLike,
  onMore,
  onAutoApply,
}: JobReelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const skills = job.skills.slice(0, MAX_SKILL_CHIPS);

  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

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
        runOnJS(onLike)();
        runOnJS(playHeartBurst)();
      }
    });

  const heartBurstStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [{ scale: heartScale.value }],
  }));

  return (
    <View style={[styles.page, { height, paddingTop, paddingBottom }]}>
      <GestureDetector gesture={doubleTap}>
        <View style={styles.tapZone}>
          {/* Soft brand-tinted glow keeps each job distinct without a loud gradient. */}
          <View
            pointerEvents="none"
            style={[styles.glow, logoColor ? { backgroundColor: logoColor } : null]}
          />

          <View style={[styles.content, { paddingRight: RAIL_RESERVED_WIDTH }]}>
            <View style={styles.companyRow}>
              <CompanyLogo logo={job.companyLogo} name={job.companyName} color={logoColor} size="md" />
              <View style={styles.companyText}>
                <Text style={styles.companyName} numberOfLines={1}>
                  {job.companyName}
                </Text>
                <Text style={styles.posted}>{formatPostedAt(job.postedAt)}</Text>
              </View>
            </View>

            <Text style={styles.title}>{job.title}</Text>

            <JobMetadata job={job} emphasizeSalary />

            <Text
              style={styles.description}
              numberOfLines={expanded ? undefined : DESCRIPTION_COLLAPSED_LINES}>
              {job.description}
            </Text>

            <Pressable
              onPress={() => setExpanded((current) => !current)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Show less of the job description' : 'Read more of the job description'}
              style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
              <Text style={styles.readMore}>{expanded ? 'Show less' : 'Read more'}</Text>
            </Pressable>

            <View style={styles.skills}>
              {skills.map((skill) => (
                <SkillChip key={skill} label={skill} />
              ))}
            </View>
          </View>

          <Animated.View pointerEvents="none" style={[styles.heartBurst, heartBurstStyle]}>
            <Ionicons name="heart" size={104} color={colors.like} />
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={[styles.rail, { bottom: paddingBottom }]}>
        <ReelActionRail
          isLiked={job.isLiked}
          onLike={onLike}
          onMore={onMore}
          onAutoApply={onAutoApply}
          jobTitle={job.title}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    paddingHorizontal: screenPadding,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  tapZone: {
    flex: 1,
  },
  glow: {
    position: 'absolute',
    top: -160,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: radius.pill,
    opacity: 0.14,
    backgroundColor: colors.text,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
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
  readMore: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
  skills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
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
});
