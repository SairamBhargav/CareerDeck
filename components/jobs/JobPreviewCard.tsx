import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { IconButton } from '@/components/common/IconButton';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import type { Job } from '@/types';
import { formatLocationLine, formatPostedAt, formatSalary } from '@/utils/format';

interface JobPreviewCardProps {
  job: Job;
  logoColor?: string;
  onPress?: () => void;
  onToggleSave: () => void;
}

/** Compact row used by the vertical "Your Feed" list on Home. Not the full-screen reel. */
export function JobPreviewCard({ job, logoColor, onPress, onToggleSave }: JobPreviewCardProps) {
  const salary = formatSalary(job);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${job.title} at ${job.companyName}`}
      style={({ pressed }) => [styles.card, pressed && onPress ? styles.pressed : null]}>
      <View style={styles.header}>
        <CompanyLogo logo={job.companyLogo} name={job.companyName} color={logoColor} size="sm" />

        <View style={styles.headerText}>
          <Text style={styles.company} numberOfLines={1}>
            {job.companyName}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {job.title}
          </Text>
        </View>

        <IconButton
          name={job.isSaved ? 'bookmark' : 'bookmark-outline'}
          color={job.isSaved ? colors.save : colors.textTertiary}
          onPress={onToggleSave}
          accessibilityLabel={job.isSaved ? `Unsave ${job.title}` : `Save ${job.title}`}
        />
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {formatLocationLine(job)}
      </Text>
      {salary ? <Text style={styles.salary}>{salary}</Text> : null}

      <Text style={styles.description} numberOfLines={2}>
        {job.description}
      </Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{formatPostedAt(job.postedAt)}</Text>
        {job.isSaved ? (
          <>
            <Text style={styles.footerDot}>{'·'}</Text>
            <Text style={styles.footerText}>Saved</Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  pressed: {
    backgroundColor: colors.surfaceRaised,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  company: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
    lineHeight: 23,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  salary: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  description: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  footerText: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  footerDot: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
});
