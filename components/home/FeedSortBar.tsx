import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { JobSort } from '@/hooks/useJobFeeds';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const OPTIONS: { key: JobSort; label: string }[] = [
  { key: 'recent', label: 'Most recent' },
  { key: 'salary', label: 'Top salary' },
  { key: 'company', label: 'Company A–Z' },
];

/** Long enough to read as a fill sweeping in, short enough not to lag the list re-sorting under it. */
const SELECT_MS = 180;

interface FeedSortBarProps {
  sort: JobSort;
  onChange: (sort: JobSort) => void;
}

/**
 * Sort control for Home's feed. A scrolling chip row rather than a dropdown: there are
 * only three options and they fit, so showing all of them costs one row and saves the
 * user a tap plus a menu they have to read.
 */
export function FeedSortBar({ sort, onChange }: FeedSortBarProps) {
  const styles = useStyles();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      // The chips are a control, not content — a stray horizontal drag shouldn't
      // steal the gesture from the page scrolling vertically behind it.
      directionalLockEnabled>
      {OPTIONS.map((option) => (
        <SortChip
          key={option.key}
          label={option.label}
          selected={option.key === sort}
          onPress={() => {
            if (option.key === sort) return;
            Haptics.selectionAsync();
            onChange(option.key);
          }}
        />
      ))}
    </ScrollView>
  );
}

interface SortChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function SortChip({ label, selected, onPress }: SortChipProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const active = useDerivedValue(() => withTiming(selected ? 1 : 0, { duration: SELECT_MS }), [selected]);

  const chipStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(active.value, [0, 1], [colors.backgroundMuted, colors.accent]),
    borderColor: interpolateColor(active.value, [0, 1], [colors.border, colors.accent]),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(active.value, [0, 1], [colors.textSecondary, colors.accentText]),
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Sort by ${label.toLowerCase()}`}
      style={[styles.chip, chipStyle]}>
      <Animated.Text style={[styles.chipLabel, labelStyle]}>{label}</Animated.Text>
    </AnimatedPressable>
  );
}

const useStyles = makeStyles(() => ({
  row: {
    paddingHorizontal: screenPadding,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
  },
}));
