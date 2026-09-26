import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StoryArticleSheet } from '@/components/stories/StoryArticleSheet';
import { StoryPage } from '@/components/stories/StoryPage';
import { useTheme } from '@/context/ThemeContext';
import type { Company, StoryGroup } from '@/types';

/** How long one story holds before advancing itself. */
const STORY_DURATION = 5000;

interface StoryViewerProps {
  /** Snapshot taken when the viewer opened — see HomeScreen's story session. */
  groups: StoryGroup[];
  startGroupIndex: number;
  startItemIndex: number;
  /**
   * Keyed by **slug**, not uuid. A `NewsItem.companyId` has held a slug since phase 1
   * (see `useNewsFeed`), and follows key on the slug too — so the one map serves both.
   */
  companyBySlug: Map<string, Company>;
  onClose: () => void;
  onSeen: (newsId: string) => void;
  /** Takes the company **slug** — `toggleFollow` keys on the slug, not the uuid. */
  onToggleFollow: (companySlug: string) => void;
}

/**
 * Full-screen story playback, on Instagram's split: **tapping** moves through one
 * company's stories and rolls over into the next company after its last one, while
 * **swiping** always jumps a whole company at a time.
 *
 * The companies ride a horizontal paging list rather than a state index, so the swipe is
 * the thing driving the view — drag halfway and you hold both companies on screen at
 * once, let go and it settles onto whichever one you committed to. Holding pauses the
 * timer, swiping down leaves, and "Read more" opens the full article over the top.
 */
export function StoryViewer({
  groups,
  startGroupIndex,
  startItemIndex,
  companyBySlug,
  onClose,
  onSeen,
  onToggleFollow,
}: StoryViewerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const listRef = useRef<FlatList<StoryGroup>>(null);

  const [groupIndex, setGroupIndex] = useState(startGroupIndex);
  const [articleOpen, setArticleOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [swiping, setSwiping] = useState(false);

  // Each company remembers how far into its own stories you got, so swiping away and
  // back doesn't restart it. Companies you haven't opened default to their first story.
  const [itemIndexByGroup, setItemIndexByGroup] = useState<Record<string, number>>(() => {
    const first = groups[startGroupIndex];
    return first ? { [first.id]: startItemIndex } : {};
  });

  const progress = useSharedValue(0);
  /** Parked at zero — handed to the pages either side so their bars sit empty. */
  const idleProgress = useSharedValue(0);
  const dragY = useSharedValue(0);

  const group = groups[groupIndex];
  const itemIndex = group ? itemIndexByGroup[group.id] ?? 0 : 0;
  const item = group?.items[itemIndex];
  const company = item?.companyId ? companyBySlug.get(item.companyId) : undefined;

  // The timer stops for anything that takes attention off the story itself.
  const paused = articleOpen || held || swiping;

  // The timer has to call "advance" from inside an animation callback, but advancing
  // depends on where we currently are — which would make the timer itself change every
  // story and restart the animation it just scheduled. A ref breaks that cycle: the
  // callback identity stays stable, and it reads the latest advance when it fires.
  const advanceRef = useRef<() => void>(() => {});
  const fireAdvance = useCallback(() => advanceRef.current(), []);

  const runProgress = useCallback(
    (from: number) => {
      cancelAnimation(progress);
      progress.value = from;
      progress.value = withTiming(
        1,
        { duration: STORY_DURATION * (1 - from), easing: Easing.linear },
        (finished) => {
          'worklet';
          if (finished) runOnJS(fireAdvance)();
        },
      );
    },
    [progress, fireAdvance],
  );

  const setItemIndexFor = useCallback((groupId: string, next: number) => {
    setItemIndexByGroup((current) => ({ ...current, [groupId]: next }));
  }, []);

  /** Slides the deck to another company. The pager's own animation is the transition. */
  const goToGroup = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next >= groups.length) {
        onClose();
        return;
      }
      setGroupIndex(next);
      listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [groups.length, onClose],
  );

  // Tapping walks this company's stories, then carries on into the next company once
  // there are none left — the one case where a tap changes company.
  const goNext = useCallback(() => {
    if (!group) {
      onClose();
      return;
    }
    if (itemIndex + 1 < group.items.length) setItemIndexFor(group.id, itemIndex + 1);
    else goToGroup(groupIndex + 1);
  }, [group, itemIndex, groupIndex, setItemIndexFor, goToGroup, onClose]);

  const goPrevious = useCallback(() => {
    if (!group) return;
    if (itemIndex > 0) setItemIndexFor(group.id, itemIndex - 1);
    else if (groupIndex > 0) goToGroup(groupIndex - 1);
    // Already at the very first story — replay it rather than doing nothing.
    else runProgress(0);
  }, [group, itemIndex, groupIndex, setItemIndexFor, goToGroup, runProgress]);

  useEffect(() => {
    advanceRef.current = goNext;
  }, [goNext]);

  // Restart the clock whenever the story itself changes. Deliberately not keyed on
  // `paused` — pausing is handled separately so a hold-and-release resumes where it
  // stopped instead of starting the story over.
  useEffect(() => {
    if (paused) return;
    runProgress(0);
    return () => cancelAnimation(progress);
  }, [groupIndex, itemIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Freeze and thaw without restarting: cancelling leaves the shared value where it was,
  // so resuming just runs the remainder of the duration.
  useEffect(() => {
    if (paused) cancelAnimation(progress);
    else runProgress(progress.value);
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // A story counts as watched the moment it lands on screen.
  useEffect(() => {
    if (item) onSeen(item.id);
  }, [item, onSeen]);

  /**
   * Whichever page the deck actually settled on becomes the active company. Read on
   * momentum end rather than at the end of the drag: at the moment a finger lifts the
   * deck is still wherever it was released, so a quick flick would round to the company
   * you just left and start its timer for a frame before correcting itself.
   */
  const handleSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const settled = Math.round(event.nativeEvent.contentOffset.x / width);
      setSwiping(false);
      setGroupIndex((current) => (settled === current ? current : settled));
    },
    [width],
  );

  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  if (!group || !item) return null;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}>
      <Animated.View style={[styles.stage, { backgroundColor: colors.background }, stageStyle]}>
        <FlatList
          ref={listRef}
          data={groups}
          keyExtractor={(storyGroup) => storyGroup.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startGroupIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onScrollBeginDrag={() => setSwiping(true)}
          // A drag too small to start momentum snaps back to the same page, so there is
          // nothing to re-read — just let the timer run again.
          onScrollEndDrag={() => setSwiping(false)}
          onMomentumScrollEnd={handleSettled}
          // Without this the list treats its cells as pure and a tap to the next story
          // would leave the page it re-rendered showing the previous one.
          extraData={`${groupIndex}:${itemIndex}`}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item: storyGroup, index }) => (
            <StoryPage
              group={storyGroup}
              itemIndex={itemIndexByGroup[storyGroup.id] ?? 0}
              width={width}
              insets={insets}
              progress={index === groupIndex ? progress : idleProgress}
              dragY={dragY}
              onNext={goNext}
              onPrevious={goPrevious}
              onHoldChange={setHeld}
              onClose={onClose}
              onReadMore={() => setArticleOpen(true)}
            />
          )}
        />

        {articleOpen ? (
          <StoryArticleSheet
            item={item}
            company={company}
            onClose={() => setArticleOpen(false)}
            onToggleFollow={() => {
              if (company) onToggleFollow(company.slug);
            }}
          />
        ) : null}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
  },
});
