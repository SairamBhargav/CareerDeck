import { useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { ApplicationModal } from '@/components/jobs/ApplicationModal';
import { FeedToggle } from '@/components/reels/FeedToggle';
import { JobReelCard } from '@/components/reels/JobReelCard';
import { colors, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useJobFeeds, type ReelFeed } from '@/hooks/useJobFeeds';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Job } from '@/types';

const TOGGLE_HEIGHT = 44;

export default function ReelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The Reels tab stays mounted when other tabs are shown, so the light status bar
  // is only applied while this route is the active segment.
  const isFocused = useSegments().at(-1) === 'reels';
  const { user, companies, toggleLike, toggleSave } = useCareerDeck();
  const { forYouJobs, followingJobs } = useJobFeeds();
  const tabBarHeight = useTabBarHeight();

  const [feed, setFeed] = useState<ReelFeed>('forYou');
  const [pageHeight, setPageHeight] = useState(0);
  const [applyJob, setApplyJob] = useState<Job | null>(null);

  const listRef = useRef<FlatList<Job>>(null);

  const jobs = feed === 'forYou' ? forYouJobs : followingJobs;

  const logoColorByCompany = useMemo(
    () => new Map(companies.map((company) => [company.id, company.logoColor])),
    [companies],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setPageHeight(event.nativeEvent.layout.height);
  }, []);

  const handleFeedChange = useCallback((next: ReelFeed) => {
    setFeed(next);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // Each reel fills the tab content area; the toggle floats above it and the floating
  // tab bar floats below it, so both ends reserve space for their overlay.
  const cardPaddingTop = insets.top + TOGGLE_HEIGHT + spacing.lg;
  const cardPaddingBottom = tabBarHeight + spacing.lg;

  return (
    <View style={styles.screen} onLayout={handleLayout}>
      {isFocused ? <StatusBar style="light" /> : null}

      {pageHeight > 0 ? (
        jobs.length > 0 ? (
          <FlatList
            ref={listRef}
            data={jobs}
            keyExtractor={(job) => job.id}
            pagingEnabled
            snapToInterval={pageHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, index) => ({
              length: pageHeight,
              offset: pageHeight * index,
              index,
            })}
            initialNumToRender={2}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews
            viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
            renderItem={({ item }) => (
              <JobReelCard
                job={item}
                height={pageHeight}
                paddingTop={cardPaddingTop}
                paddingBottom={cardPaddingBottom}
                logoColor={logoColorByCompany.get(item.companyId)}
                onLike={() => toggleLike(item.id)}
                onSave={() => toggleSave(item.id)}
                onApply={() => setApplyJob(item)}
                onMore={() => router.push(`/job/${item.id}`)}
              />
            )}
          />
        ) : (
          <View style={[styles.empty, { paddingTop: cardPaddingTop }]}>
            <EmptyState
              onDark
              icon="people-outline"
              title="No jobs from your companies yet"
              message="Follow companies on Home and their newest roles will show up here."
            />
          </View>
        )
      ) : null}

      <View style={[styles.toggle, { paddingTop: insets.top }]}>
        <FeedToggle value={feed} onChange={handleFeedChange} />
      </View>

      <ApplicationModal
        job={applyJob}
        user={user}
        visible={applyJob !== null}
        onClose={() => setApplyJob(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.reelBackground,
  },
  toggle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
  },
});
