import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const CARET_SPIN = { duration: 180, easing: Easing.out(Easing.cubic) };

export interface RowGroupItem {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  /** Secondary line under the label — e.g. "On" / "Off" under "Dark mode". */
  hint?: string;
  /** Static right-aligned text. Mutually exclusive with `right` and `soon`. */
  value?: string;
  /** A custom control on the right — a Toggle or the ThemeSwitch. Not navigable. */
  right?: ReactNode;
  /**
   * Marks a row as not built yet: dims it, shows a muted "Soon" pill, and disables the
   * tap — a row that visibly does nothing on press is worse than one that's honest about
   * not being ready.
   */
  soon?: boolean;
  /**
   * Turns the row into a disclosure: its accessory becomes a caret that flips as
   * `expanded` changes, and this renders beneath the row, inside the card, while it is
   * open. Content is pulled out to the card's edges so a carousel can still run off the
   * side of the screen — see `expansion` below.
   */
  content?: ReactNode;
  expanded?: boolean;
  onPress?: () => void;
}

/** The bordered "settings row" card shared by Profile's career stats and Settings. */
export function RowGroup({ items }: { items: RowGroupItem[] }) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    // The card animates its own height so opening a disclosure grows it smoothly rather
    // than snapping the rows below it down the page.
    <Animated.View style={styles.card} layout={LinearTransition.duration(220)}>
      {items.map((item, index) => {
        const isDisclosure = item.content !== undefined;
        const iconColor = item.soon ? colors.textTertiary : colors.textSecondary;

        const accessory = item.right ? (
          item.right
        ) : item.soon ? (
          <View style={styles.soonBadge}>
            <Text style={styles.soonLabel}>Soon</Text>
          </View>
        ) : isDisclosure ? (
          <View style={styles.accessory}>
            {item.value !== undefined ? (
              <Text style={styles.value} numberOfLines={1}>
                {item.value}
              </Text>
            ) : null}
            <DisclosureCaret expanded={item.expanded === true} />
          </View>
        ) : item.value !== undefined ? (
          <Text style={styles.value} numberOfLines={1}>
            {item.value}
          </Text>
        ) : item.onPress ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        ) : null;

        const rowInner = (
          <>
            <Ionicons name={item.icon} size={18} color={iconColor} />
            <View style={styles.text}>
              <Text style={[styles.label, item.soon ? styles.labelSoon : null]}>{item.label}</Text>
              {item.hint ? (
                <Text style={styles.hint} numberOfLines={1}>
                  {item.hint}
                </Text>
              ) : null}
            </View>
            {accessory}
          </>
        );

        const rowStyle = [styles.row, index > 0 ? styles.rowDivided : null];
        const interactive = item.onPress !== undefined && !item.soon;

        return (
          <View key={item.key}>
            {interactive ? (
              <Pressable
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={isDisclosure ? { expanded: item.expanded === true } : undefined}
                style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}>
                {rowInner}
              </Pressable>
            ) : (
              <View style={rowStyle}>{rowInner}</View>
            )}

            {isDisclosure && item.expanded ? (
              <Animated.View entering={FadeIn.duration(160)} style={styles.expansion}>
                {item.content}
              </Animated.View>
            ) : null}
          </View>
        );
      })}
    </Animated.View>
  );
}

/** Points down when closed, flips to point up while the row is open. */
function DisclosureCaret({ expanded }: { expanded: boolean }) {
  const { colors } = useTheme();
  const turn = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    turn.value = withTiming(expanded ? 1 : 0, CARET_SPIN);
  }, [expanded, turn]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  // Cancels the card's own padding so expanded content spans its full width; the content
  // re-applies its own inset to line up with the row above.
  expansion: {
    marginHorizontal: -spacing.lg,
  },
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '55%',
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.body,
    color: colors.text,
    fontWeight: '500',
  },
  labelSoon: {
    color: colors.textTertiary,
  },
  hint: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 1,
  },
  value: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    flexShrink: 1,
  },
  soonBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  soonLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
}));
