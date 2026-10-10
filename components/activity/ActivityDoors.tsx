import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface Door {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Colours the icon. Omitted, it takes the text colour. */
  tint?: string;
  title: string;
  detail: string;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * The lists that used to be Activity's tabs, as doors at the foot of the page.
 *
 * Liked and Comments shared a tab bar with Applications, which put the tracker behind a
 * control and gave three unrelated lists equal weight. The tracker is what Activity is for,
 * so it has the page; these open their own screens. Following came along from the old stat
 * strip, which was its only way in.
 */
export function ActivityDoors({ doors }: { doors: Door[] }) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.row}>
      {doors.map((door) => (
        <Pressable
          key={door.key}
          onPress={door.onPress}
          accessibilityRole="button"
          accessibilityLabel={door.accessibilityLabel}
          style={({ pressed }) => [styles.door, pressed ? styles.pressed : null]}>
          <Ionicons name={door.icon} size={20} color={door.tint ?? colors.text} />
          <Text style={styles.title} numberOfLines={1}>
            {door.title}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {door.detail}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
  door: {
    flex: 1,
    gap: spacing.sm - 2,
    padding: spacing.md + 2,
    borderRadius: radius.lg + 2,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.backgroundMuted,
  },
  title: {
    marginTop: 2,
    fontSize: fontSize.body,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  detail: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
