import { View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

/**
 * The shape of a reel card, while one is still being chosen.
 *
 * The Deck used to show a spinner centred in an empty screen, which says "something is
 * happening somewhere" and nothing else — on a surface that is otherwise a single
 * full-bleed card, a small turning ring in the middle of the void reads as an error state.
 *
 * This is the card's own anatomy instead: the logo and company line at the top, a title,
 * a couple of lines of blurb, a row of skill chips, and the action rail down the right.
 * Nothing animates except the shared pulse every Skeleton already has, so the screen is
 * still rather than busy, and when the real card lands it lands in the same place.
 */
export function ReelSkeleton() {
  const styles = useStyles();

  return (
    <View style={styles.card} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.company}>
        <Skeleton width={48} height={48} borderRadius={radius.lg} />
        <View style={styles.companyText}>
          <Skeleton width={128} height={13} />
          <Skeleton width={76} height={11} />
        </View>
      </View>

      <View style={styles.title}>
        <Skeleton height={24} />
        <Skeleton width="62%" height={24} />
      </View>

      <View style={styles.meta}>
        <Skeleton width="48%" height={13} />
        <Skeleton width="34%" height={13} />
      </View>

      <View style={styles.blurb}>
        <Skeleton height={12} />
        <Skeleton height={12} />
        <Skeleton width="78%" height={12} />
      </View>

      <View style={styles.chips}>
        <Skeleton width={74} height={28} borderRadius={radius.pill} />
        <Skeleton width={92} height={28} borderRadius={radius.pill} />
        <Skeleton width={64} height={28} borderRadius={radius.pill} />
      </View>

      {/* The rail, so the right edge is not conspicuously empty while the rest fills in. */}
      <View style={styles.rail}>
        <Skeleton width={44} height={44} borderRadius={radius.pill} />
        <Skeleton width={44} height={44} borderRadius={radius.pill} />
        <Skeleton width={52} height={52} borderRadius={radius.pill} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: {
    flex: 1,
    paddingHorizontal: screenPadding,
    // Mirrors the reel card: content down the left, rail reserved on the right.
    paddingRight: 92,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  company: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  companyText: {
    gap: spacing.xs,
  },
  title: {
    gap: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  blurb: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rail: {
    position: 'absolute',
    right: screenPadding,
    bottom: spacing.xxl,
    alignItems: 'center',
    gap: spacing.lg,
  },
}));
