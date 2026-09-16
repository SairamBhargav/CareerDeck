import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '@/constants/theme';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
}

export function SectionHeader({ title, actionLabel, onActionPress }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title} accessibilityRole="header">
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

const styles = StyleSheet.create({
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
  action: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
});
