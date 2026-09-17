import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/common/SectionHeader';
import { HomeHeader } from '@/components/home/HomeHeader';
import { NewsCarousel } from '@/components/home/NewsCarousel';
import { ResumeCarousel } from '@/components/home/ResumeCarousel';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { colors, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useJobFeeds } from '@/hooks/useJobFeeds';
import { useNewsFeed } from '@/hooks/useNewsFeed';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { NewsItem } from '@/types';

export default function HomeScreen() {
  const router = useRouter();
  const { user, companies, resumes, defaultResumeId, toggleFollow, setDefaultResume } = useCareerDeck();
  const { suggestedCompanies } = useJobFeeds();
  const newsFeed = useNewsFeed();
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const logoColorByCompany = useMemo(
    () => new Map(companies.map((company) => [company.id, company.logoColor])),
    [companies],
  );

  const handlePressNews = (item: NewsItem) =>
    router.push({ pathname: '/news/[id]', params: { id: item.id } });

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
          onSelect={setDefaultResume}
          onSeeAll={() => router.push('/profile')}
        />

        <SuggestedCompanies
          companies={suggestedCompanies}
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
            onPressItem={handlePressNews}
          />
        </View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const styles = StyleSheet.create({
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
});
