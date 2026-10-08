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
  onToggleLike: () => void;
  /**
   * Opens the company. Optional, because the company's own page lists jobs too and a logo
   * there would lead where the reader already is.
   */
  onCompanyPress?: () => void;
  /** Home only, and only for the accessibility actions — the gesture itself lives in
   *  SwipeableJobRow. Activity shows the same card with no swipe and passes neither. */
  onHide?: () => void;
  onLike?: () => void;
}

/**
 * Compact row card for Home's vertical "Your Feed" — the one place besides Reels a
 * posting shows up, and the only one that's a plain scannable list rather than a
 * full-bleed card.
 */
export function JobFeedCard({
  job,
  logoColor,
  logoUrl,
  onPress,
  onToggleLike,
  onCompanyPress,
  onHide,
  onLike,
}: JobFeedCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const salary = formatSalary(job);

  /*
   * The swipes, offered as named actions.
   *
   * A gesture does not exist for a screen reader, and hiding a posting is the one action
   * here with no other way to reach it — so without this, the feed would have a destructive
   * action available only to people who can flick a card sideways.
   */
  const swipeActions = [
    ...(onHide ? [{ name: 'hide', label: 'Hide this job' }] : []),
    ...(onLike ? [{ name: 'like', label: 'Like and add to the apply list' }] : []),
  ];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.companyName}`}
      accessibilityActions={swipeActions.length > 0 ? swipeActions : undefined}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'hide') onHide?.();
        if (nativeEvent.actionName === 'like') onLike?.();
      }}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.header}>
        {/* The mark is the company's, so it goes to the company — the same thing it does
            on a Deck card and in a story header. Nested inside the card's own Pressable,
            which the inner one wins, exactly as the like button already does. */}
        {onCompanyPress ? (
          <Pressable
            onPress={onCompanyPress}
            accessibilityRole="link"
            accessibilityLabel={`Open ${job.companyName}`}
            hitSlop={6}
            style={({ pressed }) => (pressed ? styles.logoPressed : undefined)}>
            <CompanyLogo logo={logoUrl ?? job.companyLogo} name={job.companyName} color={logoColor} size="sm" />
          </Pressable>
        ) : (
          <CompanyLogo logo={logoUrl ?? job.companyLogo} name={job.companyName} color={logoColor} size="sm" />
        )}

        <View style={styles.headerText}>
          <Text style={styles.company} numberOfLines={1}>
            {job.companyName}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {job.title}
          </Text>
        </View>

        <IconButton
          name={job.isLiked ? 'heart' : 'heart-outline'}
          color={job.isLiked ? colors.like : colors.textTertiary}
          onPress={onToggleLike}
          accessibilityLabel={job.isLiked ? `Unlike ${job.title}` : `Like ${job.title}`}
        />
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {formatLocationLine(job)}
      </Text>
      {salary ? <Text style={styles.salary}>{salary}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.footerText}>{formatPostedAt(job.postedAt)}</Text>
        {job.isLiked ? (
          <>
            <Text style={styles.footerDot}>{'·'}</Text>
            <Text style={styles.footerText}>Liked</Text>
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
  logoPressed: {
    opacity: 0.6,
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
