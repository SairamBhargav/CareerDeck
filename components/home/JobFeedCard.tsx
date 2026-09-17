import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { IconButton } from '@/components/common/IconButton';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Job } from '@/types';
import { formatLocationLine, formatPostedAt, formatSalary } from '@/utils/format';

interface JobFeedCardProps {
  job: Job;
  logoColor?: string;
  logoUrl?: string;
  onPress: () => void;
  onToggleSave: () => void;
}

/**
 * Compact row card for Home's vertical "Your Feed" — the one place besides Reels a
 * posting shows up, and the only one that's a plain scannable list rather than a
 * full-bleed card.
 */
export function JobFeedCard({ job, logoColor, logoUrl, onPress, onToggleSave }: JobFeedCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const salary = formatSalary(job);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.companyName}`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.header}>
        <CompanyLogo logo={logoUrl ?? job.companyLogo} name={job.companyName} color={logoColor} size="sm" />

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
          color={job.isSaved ? colors.text : colors.textTertiary}
          onPress={onToggleSave}
          accessibilityLabel={job.isSaved ? `Unsave ${job.title}` : `Save ${job.title}`}
        />
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {formatLocationLine(job)}
      </Text>
      {salary ? <Text style={styles.salary}>{salary}</Text> : null}

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

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  pressed: {
    backgroundColor: colors.backgroundMuted,
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
}));
