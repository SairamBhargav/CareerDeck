import { Pressable, Text, View } from 'react-native';

import { fontSize, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

export interface Stat {
  label: string;
  value: number;
  onPress?: () => void;
  /** Marks this stat as the currently selected filter — see Activity. */
  active?: boolean;
}

/** Inline dashboard figures, separated by thin rules rather than boxed cards. */
export function StatRow({ stats }: { stats: Stat[] }) {
  const styles = useStyles();

  return (
    <View style={styles.row}>
      {stats.map((stat, index) => {
        const content = (
          <>
            <Text
              style={[styles.value, stat.active ? styles.valueActive : null]}
              accessibilityLabel={`${stat.value} ${stat.label}`}
              accessibilityRole="text">
              {stat.value}
            </Text>
            <Text style={[styles.label, stat.active ? styles.labelActive : null]}>{stat.label}</Text>
            <View style={[styles.indicator, stat.active ? styles.indicatorActive : null]} />
          </>
        );

        if (stat.onPress) {
          return (
            <Pressable
              key={stat.label}
              onPress={stat.onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: stat.active }}
              accessibilityLabel={`Show ${stat.label}`}
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

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
  valueActive: {
    color: colors.text,
  },
  label: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
    textAlign: 'center',
  },
  labelActive: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  // A small bar under the active filter — same visual language as the reel tab bar's
  // sliding indicator, so "this is the selected one" reads consistently across the app.
  indicator: {
    marginTop: 6,
    width: 20,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
}));
