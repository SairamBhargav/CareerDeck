import { useMemo } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { NEWS_CARD_HEIGHT, NewsCard } from '@/components/home/NewsCard';
import { screenPadding, spacing } from '@/constants/theme';
import type { NewsItem } from '@/types';

/**
 * How many times the base feed repeats to back the carousel. FlatList only renders what's
 * in the viewport, so this costs nothing at rest — it just gives the user a long runway to
 * swipe through before the (same) content repeats, which reads as an infinite feed in
 * everyday use. A true circular buffer isn't worth the complexity for Milestone 0.
 */
const LOOP_COUNT = 30;

/** Sliver of the next card left peeking at the edge, like the reference Apple Music carousel. */
const PEEK = 28;
const GAP = spacing.md;

interface LoopedNewsItem extends NewsItem {
  _loopKey: string;
}

interface NewsCarouselProps {
  items: NewsItem[];
  companyColors: Map<string, string>;
  onPressItem: (item: NewsItem) => void;
}

export function NewsCarousel({ items, companyColors, onPressItem }: NewsCarouselProps) {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = windowWidth - screenPadding * 2 - PEEK;
  const itemLength = cardWidth + GAP;

  const loopedItems = useMemo<LoopedNewsItem[]>(() => {
    if (items.length === 0) return [];
    return Array.from({ length: LOOP_COUNT }, (_, loopIndex) =>
      items.map((item) => ({ ...item, _loopKey: `${item.id}-${loopIndex}` })),
    ).flat();
  }, [items]);

  if (loopedItems.length === 0) return null;

  // Start roughly in the middle of the loop, aligned to a repeat boundary, so the user
  // can swipe backward as freely as forward from the very first frame.
  const initialIndex = items.length * Math.floor(LOOP_COUNT / 2);

  return (
    <FlatList
      data={loopedItems}
      keyExtractor={(item) => item._loopKey}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={itemLength}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      initialScrollIndex={initialIndex}
      getItemLayout={(_, index) => ({ length: itemLength, offset: itemLength * index, index })}
      contentContainerStyle={styles.content}
      initialNumToRender={3}
      maxToRenderPerBatch={3}
      windowSize={5}
      removeClippedSubviews
      renderItem={({ item }) => (
        <View style={{ width: cardWidth, marginRight: GAP }}>
          <NewsCard
            item={item}
            width={cardWidth}
            companyColor={item.companyId ? companyColors.get(item.companyId) : undefined}
            onPress={() => onPressItem(item)}
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: screenPadding,
  },
});

export { NEWS_CARD_HEIGHT };
