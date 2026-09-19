import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company } from '@/types';
import { formatFollowerCount } from '@/utils/format';

interface CompanyResultRowProps {
  company: Company;
  onPress: () => void;
  onToggleFollow: () => void;
}

/**
 * A company in the search results. Deliberately flatter than CompanySuggestionCard —
 * results are scanned in a vertical list, so this trades that card's brand-tinted
 * presence for a row you can read a dozen of without the page turning into a quilt.
 */
export function CompanyResultRow({ company, onPress, onToggleFollow }: CompanyResultRowProps) {
  const styles = useStyles();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${company.name}, ${company.industry}`}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="md" />

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {company.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {company.industry} · {formatFollowerCount(company.followerCount)} followers
        </Text>
      </View>

      <Pressable
        onPress={onToggleFollow}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${company.isFollowing ? 'Unfollow' : 'Follow'} ${company.name}`}
        style={({ pressed }) => [
          styles.follow,
          company.isFollowing ? styles.following : null,
          pressed ? styles.pressed : null,
        ]}>
        <Text style={[styles.followLabel, company.isFollowing ? styles.followingLabel : null]}>
          {company.isFollowing ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  follow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  following: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  followLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.accentText,
  },
  followingLabel: {
    color: colors.textSecondary,
  },
}));
