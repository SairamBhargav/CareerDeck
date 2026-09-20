import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { ApplicationModal } from '@/components/jobs/ApplicationModal';
import { JobDetailsModal } from '@/components/jobs/JobDetailsModal';
import { FeedToggle } from '@/components/reels/FeedToggle';
import { JobReelCard } from '@/components/reels/JobReelCard';
import { INDICATOR_TRAVEL, ReelsRefreshIndicator } from '@/components/reels/ReelsRefreshIndicator';
import { spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useJobFeeds, type ReelFeed } from '@/hooks/useJobFeeds';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Job } from '@/types';

const TOGGLE_HEIGHT = 44;

/** How far past the top edge the user has to drag before a release triggers a refresh. */
const PULL_THRESHOLD = 88;
/** Stand-in for a real network round trip — see handleRefresh. */
const REFRESH_DURATION = 1100;

export default function ReelsScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { companies, defaultResume, toggleLike, toggleSave } = useCareerDeck();
  const { forYouJobs, followingJobs } = useJobFeeds();
  const tabBarHeight = useTabBarHeight();

  const [feed, setFeed] = useState<ReelFeed>('forYou');
  const [pageHeight, setPageHeight] = useState(0);
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const [detailsJob, setDetailsJob] = useState<Job | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

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

  const baseJobs = feed === 'forYou' ? forYouJobs : followingJobs;

  // There's no backend yet, so a "refresh" rotates the feed instead of fetching: enough
  // for a different role to land on top, so the gesture visibly does something. Replace
  // this whole memo with the refetched list once the API exists.
  const jobs = useMemo(() => {
    if (refreshNonce === 0 || baseJobs.length < 2) return baseJobs;
    const offset = refreshNonce % baseJobs.length;
    return [...baseJobs.slice(offset), ...baseJobs.slice(0, offset)];
  }, [baseJobs, refreshNonce]);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setPageHeight(event.nativeEvent.layout.height);
  }, []);

  const handleFeedChange = useCallback((next: ReelFeed) => {
    setFeed(next);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // A light tick the instant the drag passes the release point, so the threshold is felt
  // rather than guessed at.
  const notifyArmed = useCallback(() => {
    Haptics.selectionAsync();
  }, []);

  const handleRefresh = useCallback(() => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    active.value = withSpring(1, { damping: 15, stiffness: 180 });
    spin.value = withRepeat(withTiming(360, { duration: 850, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);

    refreshTimer.current = setTimeout(() => {
      setRefreshNonce((current) => current + 1);
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
  }, [active, pulse, spin]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
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
  const handleAutoApply = useCallback((job: Job) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    autoApplyTimer.current = setTimeout(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      90,
    );
    setApplyJob(job);
  }, []);

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
              renderItem={({ item }) => (
                <JobReelCard
                  job={item}
                  height={pageHeight}
                  paddingTop={cardPaddingTop}
                  paddingBottom={cardPaddingBottom}
                  logoColor={companyById.get(item.companyId)?.logoColor}
                  logoUrl={companyById.get(item.companyId)?.logo}
                  onLike={() => toggleLike(item.id)}
                  onSave={() => toggleSave(item.id)}
                  onOpenDetails={() => setDetailsJob(item)}
                  onAutoApply={() => handleAutoApply(item)}
                />
              )}
            />
          </Animated.View>
        ) : (
          <View style={[styles.empty, { paddingTop: cardPaddingTop }]}>
            <EmptyState
              icon="people-outline"
              title="No jobs from your companies yet"
              message="Follow companies on Home and their newest roles will show up here."
            />
          </View>
        )
      ) : null}

      <ReelsRefreshIndicator pull={pull} active={active} spin={spin} pulse={pulse} top={cardPaddingTop} />

      <View style={[styles.toggle, { paddingTop: insets.top }]}>
        <FeedToggle value={feed} onChange={handleFeedChange} />
      </View>

      <JobDetailsModal
        job={detailsJob}
        logoColor={detailsJob ? companyById.get(detailsJob.companyId)?.logoColor : undefined}
        logoUrl={detailsJob ? companyById.get(detailsJob.companyId)?.logo : undefined}
        visible={detailsJob !== null}
        onClose={() => setDetailsJob(null)}
        onApply={() => {
          const job = detailsJob;
          setDetailsJob(null);
          if (job) handleAutoApply(job);
        }}
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
  empty: {
    flex: 1,
    justifyContent: 'center',
  },
}));
