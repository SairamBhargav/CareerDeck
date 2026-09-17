import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompanyListRow } from '@/components/activity/CompanyListRow';
import { EmptyState } from '@/components/common/EmptyState';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { StatRow, type Stat } from '@/components/home/StatRow';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { Job } from '@/types';

type Filter = 'following' | 'saved' | 'liked';

/**
 * Following / Saved / Liked as real, filterable lists — the record of what the user has
 * actually done, rather than a stat that just admits nothing's built yet. Applied has no
 * per-job list behind it (only a running count on the user), so it stays a plain figure.
 */
export default function ActivityScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { companies, jobs, followedCompanyIds, savedJobIds, likedJobIds, user, toggleFollow, toggleSave } =
    useCareerDeck();
  const [filter, setFilter] = useState<Filter>('following');
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);

  const followedCompanies = useMemo(
    () => companies.filter((company) => followedCompanyIds.includes(company.id)),
    [companies, followedCompanyIds],
  );
  const savedJobs = useMemo(() => jobs.filter((job) => job.isSaved), [jobs]);
  const likedJobs = useMemo(() => jobs.filter((job) => job.isLiked), [jobs]);

  const stats: Stat[] = [
    {
      label: 'Following',
      value: followedCompanyIds.length,
      active: filter === 'following',
      onPress: () => setFilter('following'),
    },
    { label: 'Applied', value: user.appliedCount },
    {
      label: 'Saved',
      value: savedJobIds.length,
      active: filter === 'saved',
      onPress: () => setFilter('saved'),
    },
    {
      label: 'Liked',
      value: likedJobIds.length,
      active: filter === 'liked',
      onPress: () => setFilter('liked'),
    },
  ];

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + tabBarHeight }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.heading} accessibilityRole="header">
          Activity
        </Text>

        <StatRow stats={stats} />

        <View style={styles.list}>
          {filter === 'following' ? (
            followedCompanies.length > 0 ? (
              followedCompanies.map((company) => (
                <CompanyListRow
                  key={company.id}
                  company={company}
                  onToggleFollow={() => toggleFollow(company.id)}
                />
              ))
            ) : (
              <EmptyState
                icon="business-outline"
                title="Not following anyone yet"
                message="Follow companies on Home and they'll show up here."
              />
            )
          ) : null}

          {filter === 'saved' ? (
            savedJobs.length > 0 ? (
              savedJobs.map((job) => (
                <JobFeedCard
                  key={job.id}
                  job={job}
                  logoColor={companyById.get(job.companyId)?.logoColor}
                  logoUrl={companyById.get(job.companyId)?.logo}
                  onPress={() => handlePressJob(job)}
                  onToggleSave={() => toggleSave(job.id)}
                />
              ))
            ) : (
              <EmptyState
                icon="bookmark-outline"
                title="No saved jobs yet"
                message="Save a posting from Home or Reels to keep it here."
              />
            )
          ) : null}

          {filter === 'liked' ? (
            likedJobs.length > 0 ? (
              likedJobs.map((job) => (
                <JobFeedCard
                  key={job.id}
                  job={job}
                  logoColor={companyById.get(job.companyId)?.logoColor}
                  logoUrl={companyById.get(job.companyId)?.logo}
                  onPress={() => handlePressJob(job)}
                  onToggleSave={() => toggleSave(job.id)}
                />
              ))
            ) : (
              <EmptyState
                icon="heart-outline"
                title="No liked jobs yet"
                message="Double-tap or like a reel in Reels to keep it here."
              />
            )
          ) : null}
        </View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: screenPadding,
    gap: spacing.lg,
  },
  heading: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    paddingTop: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
}));
