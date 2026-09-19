import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/common/SectionHeader';
import { HomeHeader } from '@/components/home/HomeHeader';
import { HomeJobFeed } from '@/components/home/HomeJobFeed';
import { StoriesRow } from '@/components/home/StoriesRow';
import { StoryViewer } from '@/components/stories/StoryViewer';
import { screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useJobFeeds } from '@/hooks/useJobFeeds';
import { firstUnseenIndex, useStoryGroups } from '@/hooks/useStoryGroups';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Job, StoryGroup } from '@/types';

export default function HomeScreen() {
  const router = useRouter();
  const styles = useStyles();
  const {
    isInitialLoading,
    user,
    companies,
    seenNewsIds,
    toggleFollow,
    toggleSave,
    markNewsSeen,
  } = useCareerDeck();
  const { forYouJobs, suggestedCompanies } = useJobFeeds();
  const storyGroups = useStoryGroups();
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  // A snapshot of the rings taken at open time. The live `storyGroups` array re-sorts as
  // stories are marked watched, which would shuffle the deck out from under an open
  // viewer mid-playback.
  const [storySession, setStorySession] = useState<StorySession | null>(null);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });

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
        <View style={styles.headerPadded}>
          <HomeHeader
            firstName={user.firstName}
            initials={initialsOf(user.firstName, user.lastName)}
            onProfilePress={() => router.push('/profile')}
          />
        </View>

        <StoriesRow groups={storyGroups} loading={isInitialLoading} onPressGroup={handlePressStory} />

        <View style={styles.feedSection}>
          <View style={styles.feedHeading}>
            <SectionHeader title="Your Feed" actionLabel="See all" onActionPress={() => router.push('/reels')} />
          </View>
          <HomeJobFeed
            jobs={forYouJobs}
            companyById={companyById}
            suggestedCompanies={suggestedCompanies}
            loading={isInitialLoading}
            onPressJob={handlePressJob}
            onToggleSave={toggleSave}
            onToggleFollow={toggleFollow}
            onSeeAllCompanies={() => router.push('/profile')}
          />
        </View>
      </Animated.ScrollView>

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

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.xl,
  },
  headerPadded: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
  },
  feedSection: {
    gap: spacing.md,
  },
  feedHeading: {
    paddingHorizontal: screenPadding,
  },
}));
