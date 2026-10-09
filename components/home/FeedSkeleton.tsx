import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

interface FeedSkeletonProps {
  rows?: number;
}

/**
 * Placeholder cards for a feed that is still loading.
 *
 * Built to JobFeedCard's own anatomy rather than as plain blocks: the logo plate, the
 * company line above a two-line title, the location, the salary, and the heart on the
 * right. Same padding, same corner radius, same hairline border as the card it stands in
 * for — so the list does not change shape when the real postings arrive, it just fills in.
 *
 * A featureless rectangle is honest about being a placeholder and useless as one: it says
 * "something is coming" where this says "a posting is coming, and it will sit here".
 */
export function FeedSkeleton({ rows = 3 }: FeedSkeletonProps) {
  const styles = useStyles();

  return (
    <View style={styles.list}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.card}>
          <View style={styles.header}>
            <Skeleton width={36} height={36} borderRadius={radius.md} />

            <View style={styles.headerText}>
              <Skeleton width={96} height={11} />
              <Skeleton height={17} />
              {/* The title runs to two lines on most postings, and the second is short. */}
              <Skeleton width="64%" height={17} />
            </View>

            <Skeleton width={22} height={22} borderRadius={radius.pill} />
          </View>

          <Skeleton width="54%" height={11} />
          <Skeleton width="38%" height={13} />

          <View style={styles.footer}>
            <Skeleton width={72} height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  list: {
    gap: spacing.md,
  },
  // Mirrors JobFeedCard exactly, so nothing shifts when the real one replaces it.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  footer: {
    marginTop: spacing.xs,
  },
}));
