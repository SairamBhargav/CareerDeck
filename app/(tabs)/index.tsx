import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { SectionHeader } from '@/components/common/SectionHeader';
import { UndoBar, type UndoBarContent } from '@/components/common/UndoBar';
import { FeedSkeleton } from '@/components/home/FeedSkeleton';
import { FeedSortBar } from '@/components/home/FeedSortBar';
import { HomeHeader } from '@/components/home/HomeHeader';
import { SearchBar } from '@/components/home/SearchBar';
import { StoriesRow } from '@/components/home/StoriesRow';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { HomeFeedRow } from '@/components/home/HomeFeedRow';
import { SearchOverlay } from '@/components/search/SearchOverlay';
import { screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useListImpressions } from '@/hooks/useImpressions';
import { RelevantHint } from '@/components/home/RelevantHint';
import { useDeckProfile, useJobFeed, useSuggestedCompanies, type JobSort } from '@/hooks/useJobFeeds';
import { firstUnseenIndex, useStoryGroups } from '@/hooks/useStoryGroups';
import { useOpenCompany } from '@/hooks/useOpenCompany';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import { flushImpressions } from '@/lib/impressions';
import type { Company, Job, StoryGroup } from '@/types';
import { greetingNameOf } from '@/utils/profile';

/** Fade for the page's first paint, once the feed resolves. */
const REVEAL_MS = 260;

/**
 * How far from the end, in screens, to start loading the next page. Half a screen is
 * enough at this row height that the reader never reaches the bottom of what is loaded.
 */
const END_REACHED_THRESHOLD = 0.5;

export default function HomeScreen() {
  const router = useGuardedRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const {
    isInitialLoading,
    user,
    seenNewsIds,
    hiddenJobIds,
    toggleFollow,
    toggleLike,
    toggleHide,
  } = useCareerDeck();

  // Relevant by default: a student opening the app wants roles for them, not the newest anything.
  const [sort, setSort] = useState<JobSort>('recommended');
  const feed = useJobFeed(sort, 'home');
  const { profile: deckProfile } = useDeckProfile();
  const {
    companies: suggestedCompanies,
    isLoading: suggestionsLoading,
    dismiss: dismissSuggestion,
    noteFollowed: noteSuggestionFollowed,
    refetch: refetchSuggestions,
  } = useSuggestedCompanies();
  const directory = useCompanyDirectory();
  const storyGroups = useStoryGroups();
  const tabBarHeight = useTabBarHeight();
  const openCompany = useOpenCompany();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);
  // §3.6. Home has no dwell to measure — the reader scrolls past cards rather than
  // sitting on one — but which postings were seen, and at what rank, is most of what a
  // ranker learns from.
  const impressions = useListImpressions('home', { resetKey: sort });

  const [searchOpen, setSearchOpen] = useState(false);

  /*
   * Rows swiped away during this session.
   *
   * Neither interaction is enough on its own to make a row leave. `hide` is a hard filter
   * in the ranker, so the posting is gone from the *next* session the server builds — but
   * not from the pages already in the react-query cache. And a right swipe writes `like`,
   * which removes nothing anywhere, by design. So the list is filtered here too.
   */
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [undo, setUndo] = useState<UndoBarContent | null>(null);

  /*
   * What the undo bar would reverse. A ref rather than state because nothing renders from
   * it, and only the most recent swipe is offered — a second swipe replaces the first, which
   * is why the bar never shows a count.
   */
  const reversible = useRef<{ job: Job; kind: 'hide' | 'like' } | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  /*
   * Pull to rebuild the feed.
   *
   * The flush before the refetch is the whole reason this does anything. Home's default
   * sort is `recommended`, which builds a fresh ranked session when it is asked for a null
   * cursor, and the ranker drops a posting it knows has already been shown by about
   * twenty-one points — so the cards just scrolled past are meant to sink and let new ones
   * up. That only happens if the database knows they were seen, and impressions batch every
   * ten seconds or twenty-five items. A pull lands inside that window almost every time, so
   * without the flush the new session scores against stale counts and comes back as the
   * same feed, which reads as a refresh that did nothing.
   *
   * Measured on the Deck, which has the same ranker behind it: two sessions built back to
   * back with nothing flushed between them agreed on all twenty of their first cards.
   *
   * `dismissed` is deliberately left alone. It holds what was swiped away, and emptying it
   * here would bring those rows back — a refresh that resurrects the cards you just got rid
   * of is worse than one that does nothing.
   */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await flushImpressions();
      await Promise.all([feed.refetch(), refetchSuggestions()]);
    } finally {
      setRefreshing(false);
    }
  }, [feed, refetchSuggestions]);

  /*
   * Sets rather than two `Array.includes` per job. `hiddenJobIds` is whatever
   * `viewer_state()` returns, up to two thousand ids, and this runs for every posting
   * loaded — a linear scan each time turns a filter into a quadratic one for no reason.
   */
  const excluded = useMemo(
    () => new Set([...dismissed, ...hiddenJobIds]),
    [dismissed, hiddenJobIds],
  );

  const visibleJobs = useMemo(
    () => feed.jobs.filter((job) => !excluded.has(job.id)),
    [feed.jobs, excluded],
  );

  const handlePressJob = useCallback(
    (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } }),
    [router],
  );

  // Routes carry the slug, not the uuid — §1.3(c): "company slugs are worth keeping,
  // they're good URLs".
  const handlePressCompany = useCallback(
    (company: Company) => router.push({ pathname: '/company/[id]', params: { id: company.slug } }),
    [router],
  );

  /*
   * Both swipes, which differ in what they write and in what they offer afterwards.
   *
   * Left writes `hide` — §3.5's hard filter, which the enum has carried since phase 2 with
   * no UI. Right writes `like`, which is a ranker signal and fills the Liked jobs
   * collection, and is the same thing the heart on the card writes: there is one way to say
   * yes to a posting now, whichever gesture reaches it.
   *
   * The invitation to apply rides on the undo bar rather than opening the apply sheet. A
   * sheet over the feed would make it impossible to triage more than one card at a time,
   * which is the whole point of swiping.
   */
  const handleSwipe = useCallback(
    (job: Job, kind: 'hide' | 'like') => {
      if (kind === 'hide') toggleHide(job.id);
      else toggleLike(job.id);

      setDismissed((current) => [job.id, ...current]);
      reversible.current = { job, kind };

      setUndo(
        kind === 'hide'
          ? { message: `Hidden · ${job.companyName}` }
          : {
              message: `Liked · ${job.companyName}`,
              action: {
                label: 'Apply',
                onPress: () => {
                  setUndo(null);
                  handlePressJob(job);
                },
              },
            },
      );
    },
    [toggleHide, toggleLike, handlePressJob],
  );

  /*
   * Both interactions are set membership rather than an event log, so calling the same
   * toggle again is the reversal — there is no separate "unhide" to write.
   */
  /*
   * Split in two, and stable.
   *
   * The row component compares its handler props by reference to decide whether to
   * re-render, so these have to keep their identity across a render of this screen — and
   * a `() => handleSwipe(item, 'hide')` built inside renderItem never would.
   */
  const handleSwipeHide = useCallback((job: Job) => handleSwipe(job, 'hide'), [handleSwipe]);
  const handleSwipeLike = useCallback((job: Job) => handleSwipe(job, 'like'), [handleSwipe]);

  /*
   * Hoisted out of the JSX for the same reason. An inline renderItem is a new function on
   * every render, which FlatList takes as "the rows may have changed" and re-renders all
   * of them — undoing the memo on the row before it can help.
   */
  const renderItem = useCallback(
    ({ item }: { item: Job }) => (
      <HomeFeedRow
        job={item}
        onPress={handlePressJob}
        onToggleLike={toggleLike}
        onCompanyPress={openCompany}
        onHide={handleSwipeHide}
        onLike={handleSwipeLike}
      />
    ),
    [handlePressJob, toggleLike, openCompany, handleSwipeHide, handleSwipeLike],
  );

  const handleUndo = useCallback(() => {
    const last = reversible.current;
    if (!last) return;

    if (last.kind === 'hide') toggleHide(last.job.id);
    else toggleLike(last.job.id);

    setDismissed((current) => current.filter((id) => id !== last.job.id));
    reversible.current = null;
    setUndo(null);
  }, [toggleHide, toggleLike]);

  // Expiry drops the offer, not the action: the row stays gone and the write stands.
  const handleUndoExpired = useCallback(() => {
    reversible.current = null;
    setUndo(null);
  }, []);

  /*
   * Following from the suggestions row, which is the one place a follow also decides whether
   * the card stays. Everywhere else `toggleFollow` is enough on its own.
   */
  const handleFollowSuggestion = useCallback(
    (companySlug: string) => {
      toggleFollow(companySlug);
      noteSuggestionFollowed(companySlug);
    },
    [toggleFollow, noteSuggestionFollowed],
  );

  /*
   * The story viewer is its own screen. It takes which ring was tapped and where in it to
   * start; the groups themselves it reads and snapshots for itself, which is what lets the
   * company sheet open over it without this screen being involved.
   */
  const handlePressStory = (group: StoryGroup) =>
    router.push({
      pathname: '/story',
      params: { group: group.id, item: String(firstUnseenIndex(group, seenNewsIds)) },
    });

  /*
   * One scroll container, not two.
   *
   * The feed used to be a plain mapped list inside a ScrollView, and HomeJobFeed's own
   * comment named the limit: "fine at the current fixture size but the thing to revisit
   * when the job list stops being a local constant." It has. Everything above the feed is
   * the list header, so the whole screen scrolls as one virtualized list and only the
   * visible cards are mounted.
   */
  const header = (
    <View style={styles.header}>
      <View style={styles.top}>
        <HomeHeader
          firstName={greetingNameOf(user)}
          handle={user?.handle || null}
          onProfilePress={() => router.push('/profile')}
        />

        <SearchBar onPress={() => setSearchOpen(true)} />
      </View>

      <StoriesRow groups={storyGroups} loading={directory.isLoading} onPressGroup={handlePressStory} />

      <SuggestedCompanies
        companies={suggestedCompanies}
        loading={suggestionsLoading}
        onPressCompany={handlePressCompany}
        onToggleFollow={handleFollowSuggestion}
        onDismiss={dismissSuggestion}
        onSeeAll={() => router.push('/profile')}
      />

      <View style={styles.feedSection}>
        <View style={styles.feedHeading}>
          {/* No "See all". It went to the Deck, which is a tab bar tap away and a
              different way of reading the same postings rather than more of them. */}
          <SectionHeader title="Your Feed" />
        </View>

        <FeedSortBar sort={sort} onChange={setSort} />

        {sort === 'recommended' && deckProfile ? (
          <RelevantHint
            knowsNothing={deckProfile.families === null && deckProfile.seniorities === null}
            missingField={deckProfile.families === null && deckProfile.seniorities !== null}
            onPress={() => router.push('/profile')}
          />
        ) : null}
      </View>
    </View>
  );

  const showSkeletons = feed.isLoading || isInitialLoading;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.FlatList
        data={visibleJobs}
        keyExtractor={(job) => job.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={
          showSkeletons ? (
            <Animated.View entering={FadeIn.duration(REVEAL_MS)} style={styles.row}>
              <FeedSkeleton />
            </Animated.View>
          ) : (
            <View style={styles.row}>
              <EmptyState
                icon="briefcase-outline"
                title={feed.error ? 'Could not load the feed' : 'No postings yet'}
                message={
                  feed.error
                    ? 'Pull to try again.'
                    : 'Nothing has been indexed for these filters. Check back shortly.'
                }
              />
            </View>
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            /*
             * The shape of what is arriving, not a spinner floating in the gap below the
             * last card. The list already opens on these, so a page loading looks like the
             * feed continuing rather than like the screen stopping to think.
             */
            <View style={styles.footer}>
              <FeedSkeleton rows={1} />
            </View>
          ) : (
            <View style={styles.footer} />
          )
        }
        onEndReached={feed.hasNextPage ? feed.fetchNextPage : undefined}
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        viewabilityConfigCallbackPairs={impressions.viewabilityConfigCallbackPairs}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            // iOS draws one spinner, Android a ring on a disc; both need telling, and
            // neither inherits anything from the theme on its own.
            tintColor={colors.textTertiary}
            colors={[colors.text]}
            progressBackgroundColor={colors.surface}
          />
        }
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxl + tabBarHeight }}
      />

      <UndoBar
        content={undo}
        onUndo={handleUndo}
        onDismiss={handleUndoExpired}
        bottomOffset={tabBarHeight + spacing.md}
      />

      <SearchOverlay
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPressJob={handlePressJob}
        onPressCompany={handlePressCompany}
        onPressCompanySlug={openCompany}
      />

    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    gap: spacing.xl,
    paddingBottom: spacing.md,
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
  // The gap that `gap: spacing.md` used to provide, now that each card is its own list
  // row rather than a child of one flex container.
  row: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.md,
  },
  footer: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.lg,
  },
}));
