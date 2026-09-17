import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '@/constants/theme';

export interface Stat {
  label: string;
  value: number;
  onPress?: () => void;
}

/** Three inline dashboard figures, separated by thin rules rather than boxed cards. */
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((stat, index) => {
        const content = (
          <>
            <Text
              style={styles.value}
              accessibilityLabel={`${stat.value} ${stat.label}`}
              accessibilityRole="text">
              {stat.value}
            </Text>
            <Text style={styles.label}>{stat.label}</Text>
          </>
        );

        if (stat.onPress) {
          return (
            <Pressable
              key={stat.label}
              onPress={stat.onPress}
              accessibilityRole="button"
              accessibilityLabel={`Open ${stat.label} list`}
              style={({ pressed }) => [styles.item, index > 0 ? styles.itemDivided : null, pressed ? styles.pressed : null]}>
              {content}
            </Pressable>
          );
        }

        return (
          <View key={stat.label} style={[styles.item, index > 0 ? styles.itemDivided : null]}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  item: {
    flex: 1,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  itemDivided: {
    borderLeftWidth: 1,
    borderLeftColor: colors.borderStrong,
    paddingLeft: spacing.lg,
  },
  value: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  label: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
