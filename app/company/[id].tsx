import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { EmptyState } from '@/components/common/EmptyState';
import { FollowButton } from '@/components/common/FollowButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { FeedSkeleton } from '@/components/home/FeedSkeleton';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useCompany } from '@/hooks/useCompanies';
import { useRenderedImpressions } from '@/hooks/useImpressions';
import { useCompanyJobs } from '@/hooks/useJobFeeds';
import { hexToRgba } from '@/utils/color';
import { formatFollowerCount } from '@/utils/format';
import type { Job } from '@/types';

/** Per-card stagger down the openings list, capped so the tail doesn't crawl in. */
const STAGGER_MS = 40;
const MAX_STAGGER_INDEX = 6;
/** How strongly the company's brand colour washes the header. Deliberately light — it sits behind text. */
const HEADER_WASH_ALPHA = 0.12;

/**
 * A company's public page, reached from search results and the suggestion cards.
 *
 * Milestone 0 has no company-authored content behind it, so the page is what the app
 * already knows: who they are, whether you follow them, and what they have open. The
 * openings list is the reason to be here — the identity block above it is context.
 */
export default function CompanyDetailScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toggleFollow, toggleSave } = useCareerDeck();
  // `id` is the slug — §1.3(c) keeps company slugs as the URL, and they survived
  // the move to uuid primary keys precisely so these links keep resolving.
  const { company, isLoading } = useCompany(id);
  const openings = useCompanyJobs(id);
  // §3.6. Called before the early returns below, because a hook that runs on some renders
  // and not others is a hook that runs once and then throws.
  useRenderedImpressions('company', openings.jobs);

  if (isLoading) {
    return (
      <View style={styles.missing}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!company) {
    return (
      <View style={styles.missing}>
        <EmptyState
          icon="business-outline"
          title="Company not found"
          message="This company is no longer part of the current directory."
        />
      </View>
    );
  }

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.header, { backgroundColor: hexToRgba(company.logoColor, HEADER_WASH_ALPHA) }]}>
        <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="xl" />

        <Text style={styles.name}>{company.name}</Text>
        <Text style={styles.meta}>
          {company.industry} · {formatFollowerCount(company.followerCount)} followers
        </Text>

        <View style={styles.action}>
          <FollowButton
            isFollowing={company.isFollowing}
            companyName={company.name}
            onToggle={() => toggleFollow(company.slug)}
            size="md"
          />
        </View>
      </View>

      <View style={styles.section}>
        {/*
          * No total any more: the openings list is paginated, so a count would be
          * "how many we have fetched so far", which is worse than no number at all.
          * A real total needs a count query per company, which phase 2 can add to
          * `companies.open_job_count` — where the suggestion rail already reads one.
          */}
        <SectionHeader title={company.openJobCount > 0 ? `Open roles (${company.openJobCount})` : 'Open roles'} />

        {openings.isLoading ? (
          <FeedSkeleton />
        ) : openings.jobs.length === 0 ? (
          <EmptyState
            icon="briefcase-outline"
            title="No open roles"
            message={`${company.name} has nothing posted right now. Follow them to hear about it first.`}
          />
        ) : (
          <View style={styles.list}>
            {openings.jobs.map((job, index) => (
              <Animated.View
                key={job.id}
                entering={FadeInDown.duration(240).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                <JobFeedCard
                  job={job}
                  logoColor={company.logoColor}
                  logoUrl={company.logo}
                  onPress={() => handlePressJob(job)}
                  onToggleSave={() => toggleSave(job.id)}
                />
              </Animated.View>
            ))}

            {openings.hasNextPage ? (
              <Pressable
                onPress={openings.fetchNextPage}
                disabled={openings.isFetchingNextPage}
                accessibilityRole="button"
                accessibilityLabel="Load more roles"
                style={styles.more}>
                {openings.isFetchingNextPage ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={styles.moreLabel}>Load more</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  name: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    marginTop: spacing.sm,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  action: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  section: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.xl,
  },
  list: {
    gap: spacing.md,
  },
  // A button rather than an onEndReached hook: this list lives inside a ScrollView
  // that also carries the company header, and nesting a FlatList in it to get scroll
  // callbacks would fight the outer scroll for one paginated section.
  more: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  moreLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
