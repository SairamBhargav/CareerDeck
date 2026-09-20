import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AUTO_APPLY_ECONOMY, WEEKLY_GOAL_OPTIONS } from '@/constants/goal';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/** Rough sense of what each target asks of a week, so the numbers aren't abstract. */
const GOAL_NOTE: Record<number, string> = {
  3: 'Casual — a few a week',
  7: 'One a day',
  14: 'Two a day',
  30: 'All-in',
};

interface GoalPickerSheetProps {
  visible: boolean;
  current: number;
  /** This week's count, so the sheet can warn when a new target is already behind. */
  countThisWeek: number;
  onSelect: (target: number) => void;
  onClose: () => void;
}

/**
 * Sets the weekly application goal.
 *
 * A fixed list rather than a stepper or a slider: the difference between 6 and 7 a
 * week isn't real, and a control that invites tuning turns a commitment into a dial
 * the user quietly lowers whenever they're behind.
 */
export function GoalPickerSheet({ visible, current, countThisWeek, onSelect, onClose }: GoalPickerSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close goal picker" />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(260)}
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.grabber} />

        <Text style={styles.title} accessibilityRole="header">
          Weekly goal
        </Text>
        <Text style={styles.subtitle}>
          How many applications to send between Monday and Sunday.
        </Text>

        <View style={styles.list}>
          {WEEKLY_GOAL_OPTIONS.map((target) => {
            const selected = target === current;

            return (
              <Pressable
                key={target}
                onPress={() => {
                  if (!selected) Haptics.selectionAsync();
                  onSelect(target);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${target} applications a week. ${GOAL_NOTE[target] ?? ''}`}
                style={({ pressed }) => [
                  styles.row,
                  selected ? styles.rowSelected : null,
                  pressed ? styles.pressed : null,
                ]}>
                <Text style={[styles.count, selected ? styles.countSelected : null]}>{target}</Text>

                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>a week</Text>
                  <Text style={styles.rowNote}>{GOAL_NOTE[target]}</Text>
                </View>

                {countThisWeek >= target ? (
                  <Text style={styles.already}>Already done</Text>
                ) : null}

                {selected ? <Ionicons name="checkmark" size={18} color={colors.goalMet} /> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          Finish a week at your goal to earn {AUTO_APPLY_ECONOMY.streakBonus} extra Auto Apply,
          or {AUTO_APPLY_ECONOMY.longStreakBonus} once the streak reaches{' '}
          {AUTO_APPLY_ECONOMY.longStreakWeeks} weeks — never more than{' '}
          {AUTO_APPLY_ECONOMY.maxWeeklyBonus} in a week. You get {AUTO_APPLY_ECONOMY.dailyGrant} a
          day either way.
        </Text>
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.xs,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  list: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowSelected: {
    borderColor: colors.goalMet,
    backgroundColor: colors.goalMetSurface,
  },
  pressed: {
    opacity: 0.8,
  },
  count: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
    // Wide enough for the two-digit targets, so every "a week" below starts on the
    // same line however many digits sit beside it.
    minWidth: 38,
  },
  countSelected: {
    color: colors.goalMet,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  rowNote: {
    fontSize: fontSize.caption + 1,
    color: colors.textTertiary,
  },
  already: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  footnote: {
    marginTop: spacing.lg,
    fontSize: fontSize.caption + 1,
    lineHeight: 16,
    color: colors.textTertiary,
  },
}));
