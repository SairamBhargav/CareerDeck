import { FlatList, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { Skeleton } from '@/components/common/Skeleton';
import { STORY_CIRCLE_WIDTH, StoryCircle } from '@/components/home/StoryCircle';
import { screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { StoryGroup } from '@/types';

const SKELETON_COUNT = 5;
const LABEL_HEIGHT = 16;

interface StoriesRowProps {
  groups: StoryGroup[];
  loading: boolean;
  onPressGroup: (group: StoryGroup, index: number) => void;
}

/**
 * The row of company rings under Home's greeting — since the news carousel came out,
 * this is the only way into an article, so it carries a title like every other section
 * on the page rather than sitting there as unlabelled chrome.
 */
export function StoriesRow({ groups, loading, onPressGroup }: StoriesRowProps) {
  const styles = useStyles();

  if (!loading && groups.length === 0) return null;

  return (
    <View>
      <View style={styles.header}>
        <SectionHeader title="News" />
      </View>

      {loading ? (
        <View style={styles.skeletonRow}>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <View key={index} style={styles.skeletonItem}>
              <Skeleton width={STORY_CIRCLE_WIDTH} height={STORY_CIRCLE_WIDTH} borderRadius={999} />
              <Skeleton width={STORY_CIRCLE_WIDTH - 16} height={9} borderRadius={4} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={groups}
          keyExtractor={(group) => group.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          initialNumToRender={6}
          windowSize={5}
          renderItem={({ item, index }) => (
            <StoryCircle group={item} onPress={() => onPressGroup(item, index)} />
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  header: {
    paddingHorizontal: screenPadding,
  },
  list: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  skeletonItem: {
    alignItems: 'center',
    gap: spacing.xs + 1,
    height: STORY_CIRCLE_WIDTH + LABEL_HEIGHT,
  },
}));
