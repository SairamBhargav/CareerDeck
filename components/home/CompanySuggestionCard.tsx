import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company } from '@/types';
import { formatFollowerCount } from '@/utils/format';

export const SUGGESTION_CARD_WIDTH = 132;

interface CompanySuggestionCardProps {
  company: Company;
  onToggleFollow: () => void;
}

export function CompanySuggestionCard({ company, onToggleFollow }: CompanySuggestionCardProps) {
  const styles = useStyles();
  const { isFollowing } = company;

  return (
    <View style={styles.card}>
      <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="md" />

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {company.name}
        </Text>
        <Text style={styles.followers} numberOfLines={1}>
          {formatFollowerCount(company.followerCount)} followers
        </Text>
      </View>

      <Pressable
        onPress={onToggleFollow}
        accessibilityRole="button"
        accessibilityState={{ selected: isFollowing }}
        accessibilityLabel={
          isFollowing ? `Unfollow ${company.name}` : `Follow ${company.name}`
        }
        style={({ pressed }) => [
          styles.button,
          isFollowing ? styles.buttonFollowing : styles.buttonFollow,
          pressed ? styles.pressed : null,
        ]}>
        <Text style={[styles.buttonLabel, isFollowing ? styles.labelFollowing : styles.labelFollow]}>
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    width: SUGGESTION_CARD_WIDTH,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    alignItems: 'center',
    gap: 1,
  },
  name: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  followers: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  button: {
    minHeight: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
  },
  buttonFollow: {
    backgroundColor: colors.accent,
  },
  buttonFollowing: {
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  buttonLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
  },
  labelFollow: { color: colors.accentText },
  labelFollowing: { color: colors.textSecondary },
  pressed: {
    opacity: 0.7,
  },
}));
