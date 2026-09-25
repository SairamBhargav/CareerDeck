import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { CommentSheet } from '@/components/comments/CommentSheet';
import { ApplicationModal } from '@/components/jobs/ApplicationModal';
import { JobDetailsModal } from '@/components/jobs/JobDetailsModal';
import { FeedToggle } from '@/components/reels/FeedToggle';
import { JobReelCard } from '@/components/reels/JobReelCard';
import { INDICATOR_TRAVEL, ReelsRefreshIndicator } from '@/components/reels/ReelsRefreshIndicator';
import { MATCH_RING_SIZE, ResumeMatchRing } from '@/components/reels/ResumeMatchRing';
import { screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useCommentCounts } from '@/hooks/useComments';
import { useMatchScores, useResumes } from '@/hooks/useResumes';
import { useDwellImpressions } from '@/hooks/useImpressions';
import { useFollowingFeed, useJobFeed, type ReelFeed } from '@/hooks/useJobFeeds';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Job } from '@/types';

const TOGGLE_HEIGHT = 44;
/**
 * Drops the badge below the line it would otherwise share with the feed toggle. Level
 * with the toggle they read as one row of chrome competing for the same glance; a bit
 * lower and the badge belongs to the reel underneath it instead.
 */
const MATCH_RING_DROP = 12;

/** How far past the top edge the user has to drag before a release triggers a refresh. */
const PULL_THRESHOLD = 88;
/**
 * Minimum time the refresh indicator stays up.
 *
 * The refetch itself is usually faster than this, and an indicator that vanishes in 80ms
 * reads as the gesture having failed rather than having worked. This is a floor on the
 * animation, not a stand-in for the request — that part is real now.
 */
const REFRESH_DURATION = 900;

/** Cards left below the viewport when the next page starts loading. */
const END_REACHED_THRESHOLD = 2;

export default function ReelsScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { user, toggleLike, autoApplyCredits, spendAutoApplyCredit } = useCareerDeck();
  const { defaultResume } = useResumes(user?.id ?? null);
  const forYouFeed = useJobFeed('recent');
  const followingFeed = useFollowingFeed();
  const tabBarHeight = useTabBarHeight();
  /*
   * §3.6: "reels.tsx already knows which page is active; it just needs to time it."
   *
   * Dwell is the strongest implicit signal in the system and the reason a Reels-style UI
   * is worth building at all — how long a card held someone says far more than whether
   * they tapped anything. One impression per card, written when they leave it.
   */
  const impressions = useDwellImpressions('reels');

  const [feed, setFeed] = useState<ReelFeed>('forYou');
  const [pageHeight, setPageHeight] = useState(0);
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const [detailsJob, setDetailsJob] = useState<Job | null>(null);
  const [commentsJob, setCommentsJob] = useState<Job | null>(null);

  const listRef = useRef<FlatList<Job>>(null);

  // Pull-to-refresh motion, all on the UI thread: `pull` tracks the live drag, `active`
  // holds the indicator open after release, and spin/pulse drive the in-flight animation.
  const pull = useSharedValue(0);
  const active = useSharedValue(0);
  const spin = useSharedValue(0);
  const pulse = useSharedValue(0);
  const armed = useSharedValue(0);
  const isRefreshing = useRef(false);

  const autoApplyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (autoApplyTimer.current) clearTimeout(autoApplyTimer.current);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const activeFeed = feed === 'forYou' ? forYouFeed : followingFeed;
  const jobs = activeFeed.jobs;

  /*
   * Comment counts for the page of reels currently loaded, read separately from the feed.
   *
   * Phase 2's feed payload deliberately carries nothing that changes per reader or per second, and
   * a comment count is the second of those — folding it into `job_card` would make every feed page
   * uncacheable for a number nobody reads while scrolling. PHASE3.md §3.
   */
  const commentCounts = useCommentCounts(useMemo(() => jobs.map((job) => job.id), [jobs]));

  // No company lookup any more: the feed payload carries the logo and brand colour on
  // each posting, because the query already joins `companies` to build the card.

  /*
   * How well the default resume matches each job on screen — §3.10, read from
   * `job_match_scores` instead of hashed out of the two ids.
   *
   * Read separately from the feed for the reason the comment counts above are: a score is
   * per-reader and changes when the resume changes, so folding it into `job_card` would make
   * every feed page uncacheable. Same decision, one phase later.
   *
   * The map is empty for a user with no parsed resume, and `hasScores` below turns that into a
   * hidden ring rather than a row of zeros — 0% reads as a judgement, and the truth is that
   * nothing has been read yet.
   */
  const matchMap = useMatchScores(useMemo(() => jobs.map((job) => job.id), [jobs]));

  // In the same order as `jobs`, so the scroll-position math below can index straight into it.
  const matchScores = useMemo(
    () => jobs.map((job) => matchMap.get(job.id)?.score ?? 0),
    [jobs, matchMap],
  );
  const hasScores = matchMap.size > 0;

  // Raw scroll offset, shared with the scroll handler below — a second signal read off
  // the same `onScroll` event `pull` already listens to, not a separate subscription.
  const scrollY = useSharedValue(0);

  // The match ring's live value: interpolated between the current and next reel's score
  // by how far through the swipe the drag is, so dragging between two jobs morphs the
  // ring smoothly from one score to the other instead of snapping at the page boundary.
  const matchProgress = useDerivedValue(() => {
    if (pageHeight <= 0 || matchScores.length === 0) return matchScores[0] ?? 0;

    const floatIndex = Math.min(Math.max(scrollY.value / pageHeight, 0), matchScores.length - 1);
    const lowerIndex = Math.floor(floatIndex);
    const upperIndex = Math.min(lowerIndex + 1, matchScores.length - 1);
    const fraction = floatIndex - lowerIndex;

    const lowerScore = matchScores[lowerIndex] ?? 0;
    const upperScore = matchScores[upperIndex] ?? lowerScore;
    return lowerScore + (upperScore - lowerScore) * fraction;
  }, [matchScores, pageHeight]);

  /*
   * Which card the caption under the ring is describing.
   *
   * The ring's number is a shared value interpolated on the UI thread, so it morphs between two
   * cards without a single React render. The caption is a word, and a word cannot be
   * interpolated — it has to change at a page boundary, which means crossing to the JS thread.
   * One `setState` per card is the cost, and it is charged only when the rounded index actually
   * moves rather than on every frame.
   */
  const [activeIndex, setActiveIndex] = useState(0);
  useAnimatedReaction(
    () => (pageHeight > 0 ? Math.round(scrollY.value / pageHeight) : 0),
    (current, previous) => {
      if (current !== previous) runOnJS(setActiveIndex)(current);
    },
    [pageHeight],
  );

  const activeExplanation = useMemo(() => {
    const job = jobs[Math.min(Math.max(activeIndex, 0), Math.max(jobs.length - 1, 0))];
    const match = job ? matchMap.get(job.id) : undefined;
    return match ? { ...match.components, coverage: match.coverage } : null;
  }, [jobs, activeIndex, matchMap]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setPageHeight(event.nativeEvent.layout.height);
  }, []);

  const settleDwell = impressions.settle;

  const handleFeedChange = useCallback(
    (next: ReelFeed) => {
      // Settle before the list changes under us: the card being left is the one in the
      // feed being left, and a beat later its index means something else entirely.
      settleDwell(null);
      setFeed(next);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    },
    [settleDwell],
  );

  // A light tick the instant the drag passes the release point, so the threshold is felt
  // rather than guessed at.
  const notifyArmed = useCallback(() => {
    Haptics.selectionAsync();
  }, []);

  // A real refetch now, where this used to rotate the array to fake one. The indicator
  // is still held open for REFRESH_DURATION regardless of how fast the request comes
  // back, because the gesture needs to be felt to have worked.
  const refetchActive = activeFeed.refetch;

  const handleRefresh = useCallback(() => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    active.value = withSpring(1, { damping: 15, stiffness: 180 });
    spin.value = withRepeat(withTiming(360, { duration: 850, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);

    refetchActive();

    refreshTimer.current = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      cancelAnimation(spin);
      cancelAnimation(pulse);
      pulse.value = 0;
      active.value = withTiming(0, { duration: 260 }, (finished) => {
        'worklet';
        if (finished) spin.value = 0;
      });

      isRefreshing.current = false;
    }, REFRESH_DURATION);
  }, [active, pulse, spin, refetchActive]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      scrollY.value = event.contentOffset.y;
      pull.value = Math.max(0, -event.contentOffset.y) / PULL_THRESHOLD;

      if (pull.value >= 1 && armed.value === 0) {
        armed.value = 1;
        runOnJS(notifyArmed)();
      } else if (pull.value < 1) {
        armed.value = 0;
      }
    },
    onEndDrag: () => {
      'worklet';
      if (pull.value >= 1) runOnJS(handleRefresh)();
    },
  });

  // While a refresh is in flight the whole feed slides down, holding open the strip the
  // indicator lives in — the list itself springs back to offset 0 the moment it's released.
  const listStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: active.value * INDICATOR_TRAVEL }],
  }));

  // Shared by the rail's Auto Apply button and the details modal's, so the "strong
  // buzz" only needs to be defined once: a heavy impact immediately, followed by a
  // notification pulse a beat later so it reads as a buzz rather than a single thud.
  // Spends a credit where there is one. An empty balance still opens the sheet: nothing
  // here submits anything on the user's behalf yet, so there is no work to withhold —
  // the credit buys the pre-filled shortcut, and the button says how many are left.
  const handleAutoApply = useCallback(
    (job: Job) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      autoApplyTimer.current = setTimeout(
        () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        90,
      );
      spendAutoApplyCredit();
      setApplyJob(job);
    },
    [spendAutoApplyCredit],
  );

  // Each reel fills the tab content area; the toggle floats above it and the floating
  // tab bar floats below it, so both ends reserve space for their overlay.
  const cardPaddingTop = insets.top + TOGGLE_HEIGHT + spacing.xs;
  const cardPaddingBottom = tabBarHeight + spacing.lg;

  return (
    <View style={styles.screen} onLayout={handleLayout}>
      {pageHeight > 0 ? (
        jobs.length > 0 ? (
          <Animated.View style={[styles.listWrap, listStyle]}>
            <Animated.FlatList
              ref={listRef}
              data={jobs}
              keyExtractor={(job) => job.id}
              pagingEnabled
              snapToInterval={pageHeight}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              showsVerticalScrollIndicator={false}
              onScroll={scrollHandler}
              scrollEventThrottle={16}
              getItemLayout={(_, index) => ({
                length: pageHeight,
                offset: pageHeight * index,
                index,
              })}
              initialNumToRender={2}
              maxToRenderPerBatch={3}
              windowSize={5}
              removeClippedSubviews
              onEndReached={activeFeed.hasNextPage ? activeFeed.fetchNextPage : undefined}
              onEndReachedThreshold={END_REACHED_THRESHOLD}
              viewabilityConfigCallbackPairs={impressions.viewabilityConfigCallbackPairs}
              renderItem={({ item }) => (
                <JobReelCard
                  job={item}
                  height={pageHeight}
                  paddingTop={cardPaddingTop}
                  paddingBottom={cardPaddingBottom}
                  logoColor={item.companyLogoColor ?? undefined}
                  logoUrl={item.companyLogoUrl ?? undefined}
                  commentCount={commentCounts.get(item.id) ?? 0}
                  onLike={() => toggleLike(item.id)}
                  onComment={() => setCommentsJob(item)}
                  onMore={() => setDetailsJob(item)}
                  onAutoApply={() => handleAutoApply(item)}
                  autoApplyCredits={autoApplyCredits}
                />
              )}
            />
          </Animated.View>
        ) : (
          <View style={[styles.empty, { paddingTop: cardPaddingTop }]}>
            {activeFeed.isLoading ? (
              <ActivityIndicator />
            ) : (
              <EmptyState
                icon={feed === 'following' ? 'people-outline' : 'briefcase-outline'}
                title={
                  feed === 'following' ? 'No jobs from your companies yet' : 'Nothing to show yet'
                }
                message={
                  feed === 'following'
                    ? 'Follow companies on Home and their newest roles will show up here.'
                    : 'No postings matched. Pull down to try again.'
                }
              />
            )}
          </View>
        )
      ) : null}

      <ReelsRefreshIndicator pull={pull} active={active} spin={spin} pulse={pulse} top={cardPaddingTop} />

      <View style={[styles.toggle, { paddingTop: insets.top }]}>
        <FeedToggle value={feed} onChange={handleFeedChange} />
      </View>

      {jobs.length > 0 && hasScores ? (
        <View
          style={[
            styles.matchRingWrap,
            { top: insets.top + (TOGGLE_HEIGHT - MATCH_RING_SIZE) / 2 + MATCH_RING_DROP },
          ]}>
          <ResumeMatchRing progress={matchProgress} explain={activeExplanation} />
        </View>
      ) : null}

      <JobDetailsModal
        job={detailsJob}
        logoColor={detailsJob?.companyLogoColor ?? undefined}
        logoUrl={detailsJob?.companyLogoUrl ?? undefined}
        visible={detailsJob !== null}
        onClose={() => setDetailsJob(null)}
        onApply={() => {
          const job = detailsJob;
          setDetailsJob(null);
          if (job) handleAutoApply(job);
        }}
      />

      <CommentSheet
        // Keyed so each posting gets a clean composer — see CommentSheet.
        key={commentsJob?.id ?? 'no-comments-open'}
        job={commentsJob}
        visible={commentsJob !== null}
        onClose={() => setCommentsJob(null)}
      />

      <ApplicationModal
        job={applyJob}
        resumeName={defaultResume?.name ?? ''}
        visible={applyJob !== null}
        onClose={() => setApplyJob(null)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    // Matches each reel's own background wash, so the strip held open behind the list
    // during a refresh reads as part of the surface rather than a gap.
    backgroundColor: colors.backgroundMuted,
  },
  listWrap: {
    flex: 1,
  },
  toggle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  matchRingWrap: {
    position: 'absolute',
    right: screenPadding,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
  },
}));
