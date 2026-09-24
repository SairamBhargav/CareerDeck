import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { EmptyState } from '@/components/common/EmptyState';
import { FollowButton } from '@/components/common/FollowButton';
import { IconButton } from '@/components/common/IconButton';
import { FeedSkeleton } from '@/components/home/FeedSkeleton';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import { useJobsByIds } from '@/hooks/useJobFeeds';
import type { Company } from '@/types';
import { formatFollowerCount } from '@/utils/format';

/** Per-row stagger, capped so a long list's tail isn't left waiting. */
const STAGGER_MS = 45;
const MAX_STAGGER_INDEX = 7;

type CollectionType = 'following' | 'saved' | 'liked';

const COPY: Record<CollectionType, { title: string; empty: { icon: 'business-outline' | 'bookmark-outline' | 'heart-outline'; title: string; message: string } }> = {
  following: {
    title: 'Following',
    empty: {
      icon: 'business-outline',
      title: 'Not following anyone yet',
      message: 'Follow a company on Home and its newest roles show up in your Deck.',
    },
  },
  saved: {
    title: 'Saved jobs',
    empty: {
      icon: 'bookmark-outline',
      title: 'Nothing saved yet',
      message: 'Tap the bookmark on any posting to keep it here.',
    },
  },
  liked: {
    title: 'Liked jobs',
    empty: {
      icon: 'heart-outline',
      title: 'Nothing liked yet',
      message: 'Double-tap a card in Deck and it will be waiting here.',
    },
  },
};

function isCollectionType(value: string | undefined): value is CollectionType {
  return value === 'following' || value === 'saved' || value === 'liked';
}

/**
 * The lists behind Profile's counters.
 *
 * Following, Saved and Liked were rows showing a number with nowhere to go — the data
 * was all in state already, just unreachable. One screen serves all three because they
 * differ only in what they hold, and three near-identical files would drift apart.
 */
export default function CollectionScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { type } = useLocalSearchParams<{ type: string }>();

  const { savedJobIds, likedJobIds, followedCompanySlugs, toggleSave, toggleFollow } = useCareerDeck();
  const directory = useCompanyDirectory();

  const collection: CollectionType = isCollectionType(type) ? type : 'saved';
  const copy = COPY[collection];

  /*
   * Resolved from the viewer's own id sets, not filtered out of a loaded feed.
   *
   * These lists are exactly the case a paginated corpus breaks: a job saved last
   * week is not in the page currently loaded, so filtering would show an empty
   * Saved screen to someone with fifty saved jobs.
   */
  const wantedIds = collection === 'saved' ? savedJobIds : likedJobIds;
  const { jobs: shownJobs, isLoading: jobsLoading } = useJobsByIds(
    collection === 'following' ? [] : wantedIds,
  );

  const followed = useMemo(
    () =>
      followedCompanySlugs
        .map((slug) => directory.bySlug.get(slug))
        .filter((company): company is Company => company !== undefined),
    [followedCompanySlugs, directory],
  );

  const isLoading = collection === 'following' ? directory.isLoading : jobsLoading;
  const count = collection === 'following' ? followed.length : shownJobs.length;
  const isEmpty = count === 0 && !isLoading;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <IconButton name="chevron-back" accessibilityLabel="Go back" onPress={() => router.back()} surface />
          <View style={styles.headText}>
            <Text style={styles.heading} accessibilityRole="header">
              {copy.title}
            </Text>
            {!isEmpty ? <Text style={styles.count}>{count}</Text> : null}
          </View>
          <View style={styles.spacer} />
        </View>

        {isLoading ? (
          <FeedSkeleton />
        ) : isEmpty ? (
          <EmptyState icon={copy.empty.icon} title={copy.empty.title} message={copy.empty.message} />
        ) : collection === 'following' ? (
          <View style={styles.list}>
            {followed.map((company, index) => (
              <Animated.View
                key={company.id}
                entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                <Pressable
                  onPress={() => router.push({ pathname: '/company/[id]', params: { id: company.slug } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${company.name}`}
                  style={({ pressed }) => [styles.companyRow, pressed ? styles.pressed : null]}>
                  <CompanyLogo
                    logo={company.logo}
                    name={company.name}
                    color={company.logoColor}
                    size="md"
                  />

                  <View style={styles.companyText}>
                    <Text style={styles.companyName} numberOfLines={1}>
                      {company.name}
                    </Text>
                    <Text style={styles.companyMeta} numberOfLines={1}>
                      {formatFollowerCount(company.followerCount)} followers
                    </Text>
                  </View>

                  <FollowButton
                    isFollowing={company.isFollowing}
                    companyName={company.name}
                    onToggle={() => toggleFollow(company.slug)}
                    size="sm"
                  />
                </Pressable>
              </Animated.View>
            ))}
          </View>
        ) : (
          <View style={styles.list}>
            {shownJobs.map((job, index) => (
              <Animated.View
                key={job.id}
                entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                <JobFeedCard
                  job={job}
                  logoColor={job.companyLogoColor ?? undefined}
                  logoUrl={job.companyLogoUrl ?? undefined}
                  onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
                  onToggleSave={() => toggleSave(job.id)}
                />
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
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
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  headText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heading: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  // The tally rides beside the title rather than under it: it's an attribute of the
  // list, not a second heading.
  count: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    color: colors.textTertiary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    overflow: 'hidden',
  },
  spacer: {
    width: 44,
  },
  list: {
    gap: spacing.md,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  companyText: {
    flex: 1,
    gap: 1,
  },
  companyName: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  companyMeta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
