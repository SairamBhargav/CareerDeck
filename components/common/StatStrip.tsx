import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AnimatedCount } from '@/components/common/AnimatedCount';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

export interface StatStripItem {
  key: string;
  value: number;
  label: string;
  /** Colours the figure when it means something — a live streak, credits in hand. */
  tint?: string;
  /** Makes the figure a control. Omitted for the ones that are only a readout. */
  onPress?: () => void;
  accessibilityLabel?: string;
}

/**
 * A row of figures, divided by hairlines rather than boxed individually.
 *
 * Lifted out of ProfileHeader when the figures moved to Activity. It is a strip of numbers
 * with no opinion about which numbers — which is the point, since where they belong turned
 * out to be a question the profile answered wrongly.
 */
export function StatStrip({ items }: { items: StatStripItem[] }) {
  const styles = useStyles();

  return (
    <View style={styles.stats}>
      {items.map((item, index) => (
        <Stat key={item.key} item={item} first={index === 0} />
      ))}
    </View>
  );
}

function Stat({ item, first }: { item: StatStripItem; first: boolean }) {
  const styles = useStyles();
  const { value, label, tint, onPress, accessibilityLabel } = item;

  const body = (
    <>
      <AnimatedCount value={value} style={tint ? [styles.statValue, { color: tint }] : styles.statValue} />
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </>
  );

  if (!onPress) {
    return <View style={[styles.stat, first ? styles.statFirst : null]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.stat, first ? styles.statFirst : null, pressed ? styles.statPressed : null]}>
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  stats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    // Hairlines between them rather than around each: one object, divided.
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  statFirst: {
    borderLeftWidth: 0,
  },
  statPressed: {
    opacity: 0.6,
  },
  statValue: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
}));
