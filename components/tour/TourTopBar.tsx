import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { Spinner } from '@/components/common/Spinner';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface TourTopBarProps {
  top: number;
  /** The real deck, loading behind the tour. */
  deckReady: boolean;
}

/**
 * The deck-loading pill, top right through the tour.
 *
 * It used to share the bar with a row of progress dots, one per step (removed 2026-10-10 at
 * the user's request). Each coach bubble already says where the reader is ("ACTIVITY · 2 OF
 * 3"), so the dots were a second count of the same thing.
 */
export function TourTopBar({ top, deckReady }: TourTopBarProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View pointerEvents="none" style={[styles.bar, { top }]}>
      <View style={styles.pill} accessibilityLiveRegion="polite">
        {deckReady ? (
          <Ionicons name="checkmark-circle" size={16} color={colors.goalMet} />
        ) : (
          // The Deck's own refresh ring, so the wait reads as the deck being built.
          <Spinner size={16} stroke={2} />
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
    justifyContent: 'flex-end',
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
  pillLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
