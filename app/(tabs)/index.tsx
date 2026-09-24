import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { SectionHeader } from '@/components/common/SectionHeader';
import { FeedSkeleton } from '@/components/home/FeedSkeleton';
import { FeedSortBar } from '@/components/home/FeedSortBar';
import { HomeHeader } from '@/components/home/HomeHeader';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { SearchBar } from '@/components/home/SearchBar';
import { StoriesRow } from '@/components/home/StoriesRow';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { StoryViewer } from '@/components/stories/StoryViewer';
import { screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useListImpressions } from '@/hooks/useImpressions';
import { useJobFeed, useSuggestedCompanies, type JobSort } from '@/hooks/useJobFeeds';
import { firstUnseenIndex, useStoryGroups } from '@/hooks/useStoryGroups';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Company, Job, StoryGroup } from '@/types';
import { greetingNameOf, initialsOf } from '@/utils/profile';

/** Fade for the page's first paint, once the feed resolves. */
const REVEAL_MS = 260;

/**
 * How far from the end, in screens, to start loading the next page. Half a screen is
 * enough at this row height that the reader never reaches the bottom of what is loaded.
 */
const END_REACHED_THRESHOLD = 0.5;

export default function HomeScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { isInitialLoading, user, seenNewsIds, toggleFollow, toggleSave, markNewsSeen } = useCareerDeck();

  const [sort, setSort] = useState<JobSort>('recent');
  const feed = useJobFeed(sort);
  const { companies: suggestedCompanies, isLoading: suggestionsLoading } = useSuggestedCompanies();
  const directory = useCompanyDirectory();
  const storyGroups = useStoryGroups();
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);
  // §3.6. Home has no dwell to measure — the reader scrolls past cards rather than
  // sitting on one — but which postings were seen, and at what rank, is most of what a
  // ranker learns from.
  const impressions = useListImpressions('home', { resetKey: sort });

  const [searchOpen, setSearchOpen] = useState(false);

  // A snapshot of the rings taken at open time. The live `storyGroups` array re-sorts as
  // stories are marked watched, which would shuffle the deck out from under an open
  // viewer mid-playback.
  const [storySession, setStorySession] = useState<StorySession | null>(null);

  const handlePressJob = useCallback(
    (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } }),
    [router],
  );

  // Routes carry the slug, not the uuid — §1.3(c): "company slugs are worth keeping,
  // they're good URLs".
  const handlePressCompany = useCallback(
    (company: Company) => router.push({ pathname: '/company/[id]', params: { id: company.slug } }),
    [router],
  );

  const handlePressStory = (group: StoryGroup, index: number) =>
    setStorySession({
      groups: storyGroups,
      groupIndex: index,
      itemIndex: firstUnseenIndex(group, seenNewsIds),
    });

  /*
   * One scroll container, not two.
   *
   * The feed used to be a plain mapped list inside a ScrollView, and HomeJobFeed's own
   * comment named the limit: "fine at the current fixture size but the thing to revisit
   * when the job list stops being a local constant." It has. Everything above the feed is
   * the list header, so the whole screen scrolls as one virtualized list and only the
   * visible cards are mounted.
   */
  const header = (
    <View style={styles.header}>
      <View style={styles.top}>
        <HomeHeader
          firstName={greetingNameOf(user)}
          initials={initialsOf(user)}
          onProfilePress={() => router.push('/profile')}
        />

        <SearchBar onPress={() => setSearchOpen(true)} />
      </View>

      <StoriesRow groups={storyGroups} loading={directory.isLoading} onPressGroup={handlePressStory} />

      <SuggestedCompanies
        companies={suggestedCompanies}
        loading={suggestionsLoading}
        onPressCompany={handlePressCompany}
        onToggleFollow={toggleFollow}
        onSeeAll={() => router.push('/profile')}
      />

      <View style={styles.feedSection}>
        <View style={styles.feedHeading}>
          <SectionHeader title="Your Feed" actionLabel="See all" onActionPress={() => router.push('/reels')} />
        </View>

        <FeedSortBar sort={sort} onChange={setSort} />
      </View>
    </View>
  );

  const showSkeletons = feed.isLoading || isInitialLoading;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.FlatList
        data={feed.jobs}
        keyExtractor={(job) => job.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <JobFeedCard
              job={item}
              logoColor={item.companyLogoColor ?? undefined}
              logoUrl={item.companyLogoUrl ?? undefined}
              onPress={() => handlePressJob(item)}
              onToggleSave={() => toggleSave(item.id)}
            />
          </View>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          showSkeletons ? (
            <Animated.View entering={FadeIn.duration(REVEAL_MS)} style={styles.row}>
              <FeedSkeleton />
            </Animated.View>
          ) : (
            <View style={styles.row}>
              <EmptyState
                icon="briefcase-outline"
                title={feed.error ? 'Could not load the feed' : 'No postings yet'}
                message={
                  feed.error
                    ? 'Pull to try again.'
                    : 'Nothing has been indexed for these filters. Check back shortly.'
                }
              />
            </View>
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : <View style={styles.footer} />
        }
        onEndReached={feed.hasNextPage ? feed.fetchNextPage : undefined}
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        viewabilityConfigCallbackPairs={impressions.viewabilityConfigCallbackPairs}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxl + tabBarHeight }}
      />

      <SearchOverlay
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPressJob={handlePressJob}
        onPressCompany={handlePressCompany}
      />

      {storySession ? (
        <StoryViewer
          groups={storySession.groups}
          startGroupIndex={storySession.groupIndex}
          startItemIndex={storySession.itemIndex}
          companyById={directory.bySlug}
          onClose={() => setStorySession(null)}
          onSeen={markNewsSeen}
          onToggleFollow={toggleFollow}
        />
      ) : null}
    </SafeAreaView>
  );
}

interface StorySession {
  groups: StoryGroup[];
  groupIndex: number;
  itemIndex: number;
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    gap: spacing.xl,
    paddingBottom: spacing.md,
  },
  // Greeting and search travel together as one block, tighter than the gap between
  // sections — the search bar belongs to the header rather than being the first section.
  top: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  feedSection: {
    gap: spacing.md,
  },
  feedHeading: {
    paddingHorizontal: screenPadding,
  },
  // The gap that `gap: spacing.md` used to provide, now that each card is its own list
  // row rather than a child of one flex container.
  row: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.md,
  },
  footer: {
    paddingVertical: spacing.lg,
  },
}));
