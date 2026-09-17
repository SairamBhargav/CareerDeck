import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company } from '@/types';
import { formatFollowerCount } from '@/utils/format';

interface CompanyListRowProps {
  company: Company;
  onPress?: () => void;
  onToggleFollow: () => void;
}

/** A followed company as a horizontal row — Activity's list version of the vertical
 * CompanySuggestionCard used in Home's carousel. */
export function CompanyListRow({ company, onPress, onToggleFollow }: CompanyListRowProps) {
  const styles = useStyles();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={company.name}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}>
      <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="sm" />

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {company.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {company.industry} {'·'} {formatFollowerCount(company.followerCount)} followers
        </Text>
      </View>

      <PrimaryButton
        label="Following"
        variant="secondary"
        onPress={onToggleFollow}
        style={styles.button}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
  },
  pressed: {
    backgroundColor: colors.backgroundMuted,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: fontSize.caption + 1,
    color: colors.textTertiary,
  },
  button: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
}));
