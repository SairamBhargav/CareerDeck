import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import { radius, register, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface StatRowProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Set in capitals by the style — pass it in sentence case. */
  label: string;
  value: number;
  /** The previous period. Omit, or pass null, when there is nothing honest to compare to. */
  prior?: number | null;
  /**
   * Whether a rise is the good news. Default true.
   *
   * The arrow's direction and its colour are two different questions, and conflating them
   * is the usual bug in a row like this: a resting heart rate falling is a green arrow
   * pointing down. Here, applications rising is good and so is a response rate, but a
   * metric like days-to-first-reply would set this false.
   */
  higherIsBetter?: boolean;
  format?: (value: number) => string;
  onPress?: () => void;
}

/**
 * One measurement: what it is, what it is now, and what it was.
 *
 * A borderless fill rather than an outlined card. Where the rest of the app draws a
 * hairline around a card, this is a surface lifted off the page — which is what lets a
 * column of them read as one instrument panel instead of six separate boxes.
 */
export function StatRow({
  icon,
  label,
  value,
  prior = null,
  higherIsBetter = true,
  format = (n) => n.toLocaleString(),
  onPress,
}: StatRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const delta = prior === null || prior === value ? null : value > prior ? 'up' : 'down';
  const good = delta === null ? null : (delta === 'up') === higherIsBetter;
  const tint = good === null ? colors.textTertiary : good ? colors.goalMet : colors.danger;

  const spoken =
    delta === null
      ? `${label}, ${format(value)}`
      : `${label}, ${format(value)}, ${delta} from ${format(prior as number)}`;

  const body = (
    <>
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>

      <View style={styles.readout}>
        <View style={styles.valueRow}>
          <Text style={styles.value}>{format(value)}</Text>
          {delta ? (
            <Ionicons
              name={delta === 'up' ? 'caret-up' : 'caret-down'}
              size={14}
              color={tint}
              // The arrow repeats what the spoken label already says.
              accessibilityElementsHidden
            />
          ) : null}
        </View>
        {prior === null ? null : <Text style={styles.prior}>{format(prior)}</Text>}
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={spoken}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    /*
     * `backgroundMuted`, not `surface`, and no border.
     *
     * In dark both would read as a lift off the page, but in light `surface` is pure white
     * on a white background — invisible without the hairline the rest of the app draws. The
     * muted fill is the one that works in both, which is what makes the border unnecessary
     * rather than merely absent.
     */
    backgroundColor: colors.backgroundMuted,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    ...register.label,
    flex: 1,
    color: colors.textSecondary,
  },
  // Right-aligned as a block, so the numbers line up down the column whatever their width.
  readout: {
    alignItems: 'flex-end',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  value: {
    ...register.metric,
    color: colors.text,
  },
  prior: {
    ...register.metricPrior,
    color: colors.textTertiary,
  },
}));
