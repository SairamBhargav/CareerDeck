import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/common/SectionHeader';
import { HomeHeader } from '@/components/home/HomeHeader';
import { StatRow, type Stat } from '@/components/home/StatRow';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { JobPreviewCard } from '@/components/jobs/JobPreviewCard';
import { colors, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useJobFeeds } from '@/hooks/useJobFeeds';

const resumeOptions = [
  { id: 'engineering', name: 'Software Engineering Resume', updatedAt: 'Updated Sep 12' },
  { id: 'product', name: 'Product Design Resume', updatedAt: 'Updated Sep 7' },
  { id: 'data', name: 'Data Science Resume', updatedAt: 'Updated Aug 29' },
];

export default function HomeScreen() {
  const router = useRouter();
  const { user, companies, followedCompanyIds, savedJobIds, toggleFollow, toggleSave } = useCareerDeck();
  const { homeJobs, suggestedCompanies } = useJobFeeds();
  const [showFollowingList, setShowFollowingList] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState(resumeOptions[0].id);

  const logoColorByCompany = useMemo(
    () => new Map(companies.map((company) => [company.id, company.logoColor])),
    [companies],
  );

  const followedCompanies = companies.filter((company) => followedCompanyIds.includes(company.id));

  const stats: Stat[] = [
    {
      label: 'Following',
      value: followedCompanyIds.length,
      onPress: () => setShowFollowingList((current) => !current),
    },
    { label: 'Applied', value: user.appliedCount },
    { label: 'Queued', value: savedJobIds.length },
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

              <StatRow stats={stats} />

              {showFollowingList ? (
                <View style={styles.followingListCard}>
                  {followedCompanies.length > 0 ? (
                    followedCompanies.map((company) => (
                      <Text key={company.id} style={styles.followingCompany}>
                        • {company.name}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.emptyState}>You’re not following any companies yet.</Text>
                  )}
                </View>
              ) : null}

              <View style={styles.resumeSection}>
                <Text style={styles.resumeLabel}>Resumes</Text>
                {resumeOptions.map((resume) => {
                  const isSelected = selectedResumeId === resume.id;

                  return (
                    <Pressable
                      key={resume.id}
                      onPress={() => setSelectedResumeId(resume.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${resume.name} as default resume`}
                      style={({ pressed }) => [
                        styles.resumeCard,
                        isSelected ? styles.resumeCardSelected : null,
                        pressed ? styles.resumeCardPressed : null,
                      ]}>
                      <View style={styles.resumeIcon}>
                        <Text style={styles.resumeIconText}>CV</Text>
                      </View>

                      <View style={styles.resumeText}>
                        <Text style={styles.resumeName}>{resume.name}</Text>
                        <Text style={styles.resumeUpdated}>{resume.updatedAt}</Text>
                      </View>

                      {isSelected ? <Text style={styles.badge}>Default</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
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
  followingListCard: {
    backgroundColor: colors.backgroundMuted,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 4,
  },
  followingCompany: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  resumeSection: {
    gap: spacing.sm,
  },
  resumeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  resumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resumeCardSelected: {
    borderColor: colors.text,
    backgroundColor: '#F2F2F2',
  },
  resumeCardPressed: {
    opacity: 0.8,
  },
  resumeIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeIconText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  resumeText: {
    flex: 1,
    minWidth: 0,
  },
  resumeName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  resumeUpdated: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  feedHeading: {
    paddingHorizontal: screenPadding,
  },
  cardWrapper: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.md,
  },
});
