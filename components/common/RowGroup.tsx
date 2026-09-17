import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

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
  onPress?: () => void;
}

/** The bordered "settings row" card shared by Profile's career stats and Settings. */
export function RowGroup({ items }: { items: RowGroupItem[] }) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.card}>
      {items.map((item, index) => {
        const iconColor = item.soon ? colors.textTertiary : colors.textSecondary;
        const content = (
          <>
            <Ionicons name={item.icon} size={18} color={iconColor} />
            <View style={styles.text}>
              <Text style={[styles.label, item.soon ? styles.labelSoon : null]}>{item.label}</Text>
              {item.hint ? <Text style={styles.hint}>{item.hint}</Text> : null}
            </View>
            {item.right ? (
              item.right
            ) : item.soon ? (
              <View style={styles.soonBadge}>
                <Text style={styles.soonLabel}>Soon</Text>
              </View>
            ) : item.value !== undefined ? (
              <Text style={styles.value} numberOfLines={1}>
                {item.value}
              </Text>
            ) : item.onPress ? (
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            ) : null}
          </>
        );

        const rowStyle = [styles.row, index > 0 ? styles.rowDivided : null];

        if (item.onPress && !item.soon) {
          return (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}>
              {content}
            </Pressable>
          );
        }

        return (
          <View key={item.key} style={rowStyle}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
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
    maxWidth: '45%',
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
