import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Text, View } from 'react-native';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/** Where each section starts, so the dots read as Deck · Home · You · Activity. */
const SECTION_STARTS = new Set([6, 9, 11]);

interface TourTopBarProps {
  step: number;
  total: number;
  top: number;
  /** The real deck, loading behind the tour. */
  deckReady: boolean;
}

export function TourTopBar({ step, total, top, deckReady }: TourTopBarProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View pointerEvents="none" style={[styles.bar, { top }]}>
      <View style={styles.dots} accessibilityLabel={`Step ${step} of ${total}`}>
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <View
            key={n}
            style={[
              styles.dot,
              SECTION_STARTS.has(n) ? styles.sectionGap : null,
              n === step ? styles.dotCurrent : null,
              { backgroundColor: step >= n ? colors.text : colors.borderStrong },
            ]}
          />
        ))}
      </View>

      <View style={styles.pill} accessibilityLiveRegion="polite">
        {deckReady ? (
          <Ionicons name="checkmark-circle" size={16} color={colors.goalMet} />
        ) : (
          <ActivityIndicator size="small" color={colors.autoApply} style={styles.spinner} />
        )}
        <Text style={styles.pillLabel}>{deckReady ? 'Deck ready' : 'Building your deck'}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    position: 'absolute',
    left: screenPadding,
    right: screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  dotCurrent: {
    width: 14,
  },
  sectionGap: {
    marginLeft: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md - 1,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  spinner: {
    transform: [{ scale: 0.7 }],
    width: 16,
    height: 16,
  },
  pillLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
