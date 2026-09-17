import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/common/SectionHeader';
import { HomeHeader } from '@/components/home/HomeHeader';
import { NewsCarousel } from '@/components/home/NewsCarousel';
import { ResumeCard } from '@/components/home/ResumeCard';
import { StatRow, type Stat } from '@/components/home/StatRow';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { colors, fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useJobFeeds } from '@/hooks/useJobFeeds';
import { useNewsFeed } from '@/hooks/useNewsFeed';
import type { NewsItem } from '@/types';

export default function HomeScreen() {
  const router = useRouter();
  const { user, companies, followedCompanyIds, toggleFollow } = useCareerDeck();
  const { suggestedCompanies } = useJobFeeds();
  const newsFeed = useNewsFeed();

  const logoColorByCompany = useMemo(
    () => new Map(companies.map((company) => [company.id, company.logoColor])),
    [companies],
  );

  const stats: Stat[] = [
    { label: 'Resume', value: 1 },
    { label: 'Following', value: followedCompanyIds.length },
    { label: 'Applied', value: user.appliedCount },
  ];

  const handlePressNews = (item: NewsItem) => router.push(`/news/${item.id}`);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.headerPadded}>
          <HomeHeader
            firstName={user.firstName}
            initials={initialsOf(user.firstName, user.lastName)}
            onProfilePress={() => router.push('/profile')}
          />

          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.subtitle}>
            {user.major} {'·'} Class of {user.graduationYear}
          </Text>

          <StatRow stats={stats} />

          <ResumeCard
            resumeName={user.resumeName}
            updatedAt={user.resumeUpdatedAt}
            onPress={() => router.push('/profile')}
          />
        </View>

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
      </ScrollView>
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
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  headerPadded: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  name: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
    marginTop: spacing.md,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: -spacing.sm,
  },
  feedSection: {
    gap: spacing.md,
  },
  feedHeading: {
    paddingHorizontal: screenPadding,
  },
});
