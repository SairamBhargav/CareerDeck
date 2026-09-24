import { View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

interface FeedSkeletonProps {
  rows?: number;
}

/**
 * Placeholder cards for a feed that is still loading.
 *
 * Extracted from the old `HomeJobFeed`, which rendered the list and its skeletons
 * together. Phase 1 made the feed paginated, so the list itself became a `FlatList` owned
 * by the screen — but the skeletons are still wanted in two places (Home's empty state and
 * a company's openings), and this is all that was worth keeping.
 */
export function FeedSkeleton({ rows = 3 }: FeedSkeletonProps) {
  const styles = useStyles();

  return (
    <View style={styles.list}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={132} borderRadius={18} />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: {
    gap: spacing.md,
  },
}));
