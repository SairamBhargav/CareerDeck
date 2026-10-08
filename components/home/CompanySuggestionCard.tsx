import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { FollowButton } from '@/components/common/FollowButton';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Company } from '@/types';
import { companyAudience } from '@/utils/format';

export const SUGGESTION_CARD_WIDTH = 132;

interface CompanySuggestionCardProps {
  company: Company;
  onPress: () => void;
  onToggleFollow: () => void;
  /** Stops this company being suggested, and promotes another in its place. Omitted
   *  wherever the card is not a suggestion. */
  onDismiss?: () => void;
}

export function CompanySuggestionCard({
  company,
  onPress,
  onToggleFollow,
  onDismiss,
}: CompanySuggestionCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { isFollowing } = company;

  return (
    // The card opens the company; the button inside it stops the press from reaching
    // here, so following never doubles as navigating.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${company.name}`}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}>
      <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="md" />

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {company.name}
        </Text>
        <Text style={styles.followers} numberOfLines={1}>
          {companyAudience(company, { bare: true })}
        </Text>
      </View>

      <FollowButton
        isFollowing={isFollowing}
        companyName={company.name}
        onToggle={onToggleFollow}
        size="sm"
      />

      {/* Last in the tree so it draws over the logo, and generously slopped: the glyph is
          small enough to be unobtrusive on a 132pt card, which also makes it small enough
          to miss without the extra target around it. */}
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={`Stop suggesting ${company.name}`}
          hitSlop={12}
          style={({ pressed }) => [styles.dismiss, pressed ? styles.dismissPressed : null]}>
          <Ionicons name="close" size={13} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  cardPressed: {
    opacity: 0.85,
  },
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
  dismiss: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  dismissPressed: {
    backgroundColor: colors.backgroundMuted,
  },
}));
