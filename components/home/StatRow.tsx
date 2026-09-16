import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '@/constants/theme';

export interface Stat {
  label: string;
  value: number;
}

/** Three inline dashboard figures, separated by thin rules rather than boxed cards. */
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((stat, index) => (
        <View key={stat.label} style={[styles.item, index > 0 ? styles.itemDivided : null]}>
          <Text
            style={styles.value}
            accessibilityLabel={`${stat.value} ${stat.label}`}
            accessibilityRole="text">
            {stat.value}
          </Text>
          <Text style={styles.label}>{stat.label}</Text>
        </View>
      ))}
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
  },
  itemDivided: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    paddingLeft: spacing.lg,
  },
  value: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
  },
  label: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
});
