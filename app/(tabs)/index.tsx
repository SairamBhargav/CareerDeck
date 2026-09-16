import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/common/SectionHeader';
import { HomeHeader } from '@/components/home/HomeHeader';
import { ResumeCard } from '@/components/home/ResumeCard';
import { StatRow, type Stat } from '@/components/home/StatRow';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { JobPreviewCard } from '@/components/jobs/JobPreviewCard';
import { colors, fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useJobFeeds } from '@/hooks/useJobFeeds';

export default function HomeScreen() {
  const router = useRouter();
  const { user, companies, followedCompanyIds, toggleFollow, toggleSave } = useCareerDeck();
  const { homeJobs, suggestedCompanies } = useJobFeeds();

  const logoColorByCompany = useMemo(
    () => new Map(companies.map((company) => [company.id, company.logoColor])),
    [companies],
  );

  const stats: Stat[] = [
    { label: 'Resume', value: 1 },
    { label: 'Following', value: followedCompanyIds.length },
    { label: 'Applied', value: user.appliedCount },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <FlatList
        data={homeJobs}
        keyExtractor={(job) => job.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
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

            <View style={styles.feedHeading}>
              <SectionHeader title="Your Feed" />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrapper}>
            <JobPreviewCard
              job={item}
              logoColor={logoColorByCompany.get(item.companyId)}
              onPress={() => router.push(`/job/${item.id}`)}
              onToggleSave={() => toggleSave(item.id)}
            />
          </View>
        )}
      />
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
  listContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    gap: spacing.xl,
    paddingTop: spacing.sm,
  },
  headerPadded: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
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
  feedHeading: {
    paddingHorizontal: screenPadding,
  },
  cardWrapper: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.md,
  },
});
