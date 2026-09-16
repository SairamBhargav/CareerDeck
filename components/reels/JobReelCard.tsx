import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { SkillChip } from '@/components/common/SkillChip';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { ReelActionRail } from '@/components/reels/ReelActionRail';
import { colors, fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import type { Job } from '@/types';
import { formatPostedAt } from '@/utils/format';

const DESCRIPTION_COLLAPSED_LINES = 4;
const MAX_SKILL_CHIPS = 4;

interface JobReelCardProps {
  job: Job;
  /** Exact height of one page so paging lands on card boundaries. */
  height: number;
  /** Space reserved for the feed toggle above and the tab bar below. */
  paddingTop: number;
  paddingBottom: number;
  logoColor?: string;
  onLike: () => void;
  onSave: () => void;
  onApply: () => void;
  onMore: () => void;
}

export function JobReelCard({
  job,
  height,
  paddingTop,
  paddingBottom,
  logoColor,
  onLike,
  onSave,
  onApply,
  onMore,
}: JobReelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const skills = job.skills.slice(0, MAX_SKILL_CHIPS);

  return (
    <View style={[styles.page, { height, paddingTop, paddingBottom }]}>
      {/* Soft brand-tinted glow keeps each job distinct without a loud gradient. */}
      <View
        pointerEvents="none"
        style={[styles.glow, logoColor ? { backgroundColor: logoColor } : null]}
      />

      <View style={styles.body}>
        <View style={styles.content}>
          <View style={styles.companyRow}>
            <CompanyLogo logo={job.companyLogo} name={job.companyName} color={logoColor} size="md" onDark />
            <View style={styles.companyText}>
              <Text style={styles.companyName} numberOfLines={1}>
                {job.companyName}
              </Text>
              <Text style={styles.posted}>{formatPostedAt(job.postedAt)}</Text>
            </View>
          </View>

          <Text style={styles.title}>{job.title}</Text>

          <JobMetadata job={job} onDark emphasizeSalary />

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
              <SkillChip key={skill} label={skill} onDark />
            ))}
          </View>
        </View>

        <View style={styles.rail}>
          <ReelActionRail
            isLiked={job.isLiked}
            isSaved={job.isSaved}
            onLike={onLike}
            onSave={onSave}
            onApply={onApply}
            onMore={onMore}
            jobTitle={job.title}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    paddingHorizontal: screenPadding,
    backgroundColor: colors.reelBackground,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: -160,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: radius.pill,
    opacity: 0.16,
    backgroundColor: '#FFFFFF',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  content: {
    flex: 1,
    gap: spacing.md,
    paddingBottom: spacing.sm,
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
    color: colors.reelText,
    letterSpacing: -0.2,
  },
  posted: {
    fontSize: fontSize.small,
    color: colors.reelTextTertiary,
    marginTop: 2,
  },
  title: {
    fontSize: fontSize.hero,
    lineHeight: 39,
    fontWeight: '700',
    color: colors.reelText,
    letterSpacing: -0.8,
  },
  description: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.reelTextSecondary,
  },
  readMore: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.reelText,
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
  rail: {
    justifyContent: 'flex-end',
    paddingBottom: spacing.sm,
  },
});
