import { Pressable, Text, View } from 'react-native';

import { fontSize, register, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  /**
   * `large` sets the title in the quieter register from constants/theme.ts — bigger and
   * lighter instead of small and bold. For screens that read as a panel of readings rather
   * than a feed. Defaults to the bold voice the rest of the app uses.
   */
  size?: 'default' | 'large';
}

export function SectionHeader({
  title,
  actionLabel,
  onActionPress,
  size = 'default',
}: SectionHeaderProps) {
  const styles = useStyles();

  return (
    <View style={styles.row}>
      <Text
        style={size === 'large' ? styles.titleLarge : styles.title}
        accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}, ${title}`}
          style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  titleLarge: {
    ...register.sectionTitle,
    color: colors.text,
  },
  action: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
}));
