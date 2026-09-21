import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/common/SectionHeader';
import { HomeHeader } from '@/components/home/HomeHeader';
import { FeedSortBar } from '@/components/home/FeedSortBar';
import { HomeJobFeed } from '@/components/home/HomeJobFeed';
import { SearchBar } from '@/components/home/SearchBar';
import { StoriesRow } from '@/components/home/StoriesRow';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { StoryViewer } from '@/components/stories/StoryViewer';
import { screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useJobFeeds, useSortedJobs, type JobSort } from '@/hooks/useJobFeeds';
import { firstUnseenIndex, useStoryGroups } from '@/hooks/useStoryGroups';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Company, Job, StoryGroup } from '@/types';
import { greetingNameOf, initialsOf } from '@/utils/profile';

/** Fade for the page's first paint, once the mock "fetch" resolves. */
const REVEAL_MS = 260;

export default function HomeScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { isInitialLoading, user, companies, seenNewsIds, toggleFollow, toggleSave, markNewsSeen } =
    useCareerDeck();
  const { forYouJobs, suggestedCompanies } = useJobFeeds();
  const storyGroups = useStoryGroups();
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<JobSort>('recent');
  const sortedJobs = useSortedJobs(forYouJobs, sort);

  // A snapshot of the rings taken at open time. The live `storyGroups` array re-sorts as
  // stories are marked watched, which would shuffle the deck out from under an open
  // viewer mid-playback.
  const [storySession, setStorySession] = useState<StorySession | null>(null);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });

  const handlePressCompany = (company: Company) =>
    router.push({ pathname: '/company/[id]', params: { id: company.id } });

  const handlePressStory = (group: StoryGroup, index: number) =>
    setStorySession({
      groups: storyGroups,
      groupIndex: index,
      itemIndex: firstUnseenIndex(group, seenNewsIds),
    });

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + tabBarHeight }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <HomeHeader
            firstName={greetingNameOf(user)}
            initials={initialsOf(user)}
            onProfilePress={() => router.push('/profile')}
          />

          <SearchBar onPress={() => setSearchOpen(true)} />
        </View>

        <StoriesRow groups={storyGroups} loading={isInitialLoading} onPressGroup={handlePressStory} />

        <SuggestedCompanies
          companies={suggestedCompanies}
          loading={isInitialLoading}
          onPressCompany={handlePressCompany}
          onToggleFollow={toggleFollow}
          onSeeAll={() => router.push('/profile')}
        />

        <View style={styles.feedSection}>
          <View style={styles.feedHeading}>
            <SectionHeader title="Your Feed" actionLabel="See all" onActionPress={() => router.push('/reels')} />
          </View>

          <FeedSortBar sort={sort} onChange={setSort} />

          <Animated.View
            // Keyed on the loading flag and the sort, so the fade runs when the skeletons
            // give way to real cards and again when the order changes underneath — but
            // not on every save or follow.
            key={isInitialLoading ? 'feed-loading' : `feed-${sort}`}
            entering={FadeIn.duration(REVEAL_MS)}
            style={styles.feedPadded}>
            <HomeJobFeed
              jobs={sortedJobs}
              companyById={companyById}
              loading={isInitialLoading}
              onPressJob={handlePressJob}
              onToggleSave={toggleSave}
            />
          </Animated.View>
        </View>
      </Animated.ScrollView>

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
          companyById={companyById}
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
  content: {
    gap: spacing.xl,
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
  feedPadded: {
    paddingHorizontal: screenPadding,
  },
}));
