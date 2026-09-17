import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/common/SectionHeader';
import { HomeHeader } from '@/components/home/HomeHeader';
import { HomeJobFeed } from '@/components/home/HomeJobFeed';
import { NewsCarousel } from '@/components/home/NewsCarousel';
import { ResumeCarousel } from '@/components/home/ResumeCarousel';
import { ResumeViewerModal } from '@/components/home/ResumeViewerModal';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useJobFeeds } from '@/hooks/useJobFeeds';
import { useNewsFeed } from '@/hooks/useNewsFeed';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Job, NewsItem } from '@/types';

export default function HomeScreen() {
  const router = useRouter();
  const styles = useStyles();
  const {
    isInitialLoading,
    user,
    companies,
    resumes,
    defaultResumeId,
    toggleFollow,
    toggleSave,
    setDefaultResume,
  } = useCareerDeck();
  const { forYouJobs, suggestedCompanies } = useJobFeeds();
  const newsFeed = useNewsFeed();
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const [viewingResumeId, setViewingResumeId] = useState<string | null>(null);
  const viewingResume = resumes.find((resume) => resume.id === viewingResumeId) ?? null;

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const logoColorByCompany = useMemo(
    () => new Map(companies.map((company) => [company.id, company.logoColor])),
    [companies],
  );

  const handlePressNews = (item: NewsItem) =>
    router.push({ pathname: '/news/[id]', params: { id: item.id } });

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });

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

        <ResumeCarousel
          resumes={resumes}
          defaultResumeId={defaultResumeId}
          loading={isInitialLoading}
          onView={setViewingResumeId}
          onSeeAll={() => router.push('/profile')}
        />

        <SuggestedCompanies
          companies={suggestedCompanies}
          loading={isInitialLoading}
          onToggleFollow={toggleFollow}
          onSeeAll={() => router.push('/profile')}
        />

        <View style={styles.feedSection}>
          <View style={styles.feedHeading}>
            <SectionHeader title="Your News" />
          </View>
          <NewsCarousel
            items={newsFeed}
            companyColors={logoColorByCompany}
            loading={isInitialLoading}
            onPressItem={handlePressNews}
          />
        </View>

        <View style={styles.feedSection}>
          <View style={styles.feedHeading}>
            <SectionHeader title="Your Feed" actionLabel="See all" onActionPress={() => router.push('/reels')} />
          </View>
          <View style={styles.feedPadded}>
            <HomeJobFeed
              jobs={forYouJobs}
              companyById={companyById}
              loading={isInitialLoading}
              onPressJob={handlePressJob}
              onToggleSave={toggleSave}
            />
          </View>
        </View>
      </Animated.ScrollView>

      <ResumeViewerModal
        resume={viewingResume}
        isDefault={viewingResume?.id === defaultResumeId}
        visible={viewingResume !== null}
        onClose={() => setViewingResumeId(null)}
        onSetDefault={() => {
          if (viewingResume) setDefaultResume(viewingResume.id);
        }}
      />
    </SafeAreaView>
  );
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
  feedPadded: {
    paddingHorizontal: screenPadding,
  },
}));
