import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { ActivityHeader } from '@/components/activity/ActivityHeader';
import { ActivityTabs } from '@/components/activity/ActivityTabs';
import { ApplicationCard } from '@/components/activity/ApplicationCard';
import { WeeklyGoalCard } from '@/components/activity/WeeklyGoalCard';
import { SectionHeader } from '@/components/common/SectionHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { FeedSortBar } from '@/components/home/FeedSortBar';
import { HomeHeader } from '@/components/home/HomeHeader';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { SearchBar } from '@/components/home/SearchBar';
import { StoryTile } from '@/components/home/StoryTile';
import { FloatingTabBar } from '@/components/navigation/FloatingTabBar';
import { usePaywallColors } from '@/components/paywall/palette';
import { JobReelCard } from '@/components/reels/JobReelCard';
import { ThemeSwitch } from '@/components/settings/ThemeSwitch';
import { StoryPage } from '@/components/stories/StoryPage';
import { AvatarReveal } from '@/components/tour/AvatarReveal';
import { CoachBubble } from '@/components/tour/CoachBubble';
import { PracticeAutoApply, PracticeComments } from '@/components/tour/PracticeSheets';
import { PulseRing, useWindowRect, type WindowRect } from '@/components/tour/PulseRing';
import { TourReward } from '@/components/tour/TourReward';
import { TourTopBar } from '@/components/tour/TourTopBar';
import { fontSize, radius, screenPadding, spacing, tabBarFloatGap, tabBarHeight } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { TabBarVisibilityProvider } from '@/context/TabBarVisibilityContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useJobFeed, type JobSort } from '@/hooks/useJobFeeds';
import { profileKey, type Profile } from '@/hooks/useProfile';
import {
  PRACTICE_APPLE,
  PRACTICE_FEED_RELEVANT,
  PRACTICE_FEED_SALARY,
  PRACTICE_NVIDIA,
  PRACTICE_STORY,
  PRACTICE_STORY_ROW,
  completeTour,
  markTourFinished,
  practiceApplication,
  practiceGoal,
} from '@/lib/tour';
import { reportError } from '@/lib/observability';
import { greetingNameOf } from '@/utils/profile';

/*
 * The first-run tour.
 *
 *   0       welcome
 *   1–5     Deck: swipe, like, comments, follow, Auto Apply
 *   6–8     Home: get there, News, Your Feed's sort
 *   9–10    You: the anonymous avatar, light or dark
 *   11–13   Activity: get there, an application's stage, the weekly goal
 *   14      the reward
 *
 * Mandatory and in order: each step waits for the reader to do the thing, there is no skip, and
 * the hardware back button does nothing. What it shows is the app's own components fed practice
 * content (lib/tour.ts), so the tour looks exactly like what follows it, and nothing done here
 * is written anywhere. Meanwhile the real Deck's feed is mounted underneath, so it has loaded by
 * the time "Start swiping" hands over.
 */

const STEPS = 13;
const REWARD = 14;

const COACH: Record<number, [string, string, string]> = {
  1: ['DECK · 1 OF 5', 'Swipe up for the next job', 'Every card is a posting picked for you. Try it now.'],
  2: ['DECK · 2 OF 5', 'Like it? Double-tap.', 'Likes save the job to your list and teach your deck what you want.'],
  3: ['DECK · 3 OF 5', 'Peek at the comments', 'Students talk about every posting: questions, reactions, GIFs.'],
  4: ['DECK · 4 OF 5', 'Follow companies you like', 'Tap the + next to NVIDIA. Their new jobs show up first.'],
  5: ['DECK · 5 OF 5', 'Now Auto Apply', 'Tap the bolt. We draft the application from your resume, and you review it before anything is sent.'],
  6: ['HOME · 1 OF 3', 'Next stop: Home', 'Tap Home in the bar below.'],
  7: ['HOME · 2 OF 3', 'News on your companies', 'Tap a tile to read the latest. A colored ring means something new.'],
  8: ['HOME · 3 OF 3', 'Your Feed, your way', 'Relevant is ranked for you. Tap Top salary to see who pays the most.'],
  9: ['YOU · 1 OF 2', 'Meet the anonymous you', 'Tap your avatar, top right. That creature is how everyone else sees you.'],
  10: ['YOU · 2 OF 2', 'Light or dark?', 'Try it. You can switch anytime in Settings.'],
  11: ['ACTIVITY · 1 OF 3', 'Last stop: Activity', 'Tap Activity in the bar below.'],
  12: ['ACTIVITY · 2 OF 3', 'Your applications live here', 'The NVIDIA draft you just made is already on your list. Move it along when you hear back.'],
  13: ['ACTIVITY · 3 OF 3', 'Set a weekly goal', 'Apply a few times a week to build a streak. Streaks earn bonus Auto Applies.'],
};

const TAB_ROUTES = [
  { key: 'index', name: 'index' },
  { key: 'reels', name: 'reels' },
  { key: 'activity', name: 'activity' },
];
const TAB_TITLES = {
  index: { options: { title: 'Home' } },
  reels: { options: { title: 'Deck' } },
  activity: { options: { title: 'Activity' } },
};

/** ReelActionRail's column, measured from the bottom of its block: see the rail's styles. */
const RAIL_LIFT = spacing.sm;
const RAIL_LABEL = 14;
const RAIL_MARK = 44;
const RAIL_RING = 48;

export default function TourScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { user, credits } = useCareerDeck();

  // The real Deck, loading while the reader practises. Same hook and key as the Deck tab, so
  // the tab finds it in the cache and opens on a full deck.
  const deck = useJobFeed('recommended', 'reels');
  const deckReady = !deck.isLoading && deck.jobs.length > 0;

  const [step, setStep] = useState(0);
  const [liked, setLiked] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [sheet, setSheet] = useState<'comments' | 'apply' | 'story' | 'me' | null>(null);
  const [sort, setSort] = useState<JobSort>('recommended');
  const [stage, setStage] = useState<'applied' | 'interview'>('applied');

  const advance = useCallback((to: number, delay = 0) => {
    void Haptics.selectionAsync();
    if (delay === 0) setStep(to);
    else setTimeout(() => setStep(to), delay);
  }, []);

  // Mandatory: Android's back button would otherwise leave half a tour on the stack.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  // ── layout the rings point at ──
  const cardPaddingTop = insets.top + 44;
  const cardPaddingBottom = tabBarHeight + spacing.lg;
  const railCenterX = W - screenPadding - RAIL_RING / 2;
  const railBottom = H - (cardPaddingBottom + RAIL_LIFT);
  const boltBlock = RAIL_RING + spacing.xs + RAIL_LABEL;
  const markBlock = RAIL_MARK + spacing.xs + RAIL_LABEL;
  const rail = {
    bolt: railBottom - boltBlock + RAIL_RING / 2,
    comment: railBottom - boltBlock - spacing.lg - RAIL_MARK - spacing.lg - RAIL_LABEL - spacing.xs - RAIL_MARK / 2,
    heart:
      railBottom - boltBlock - spacing.lg - RAIL_MARK - spacing.lg - markBlock - spacing.lg - RAIL_LABEL - spacing.xs - RAIL_MARK / 2,
  };
  const circle = (cy: number, size: number): WindowRect => ({ x: railCenterX - size / 2, y: cy - size / 2, width: size, height: size });

  const barTop = H - (insets.bottom + tabBarFloatGap) - tabBarHeight;
  const tabWidth = (W - screenPadding * 2 - spacing.xs * 2) / 3;
  const tabRect = (index: number): WindowRect => ({
    x: screenPadding + spacing.xs + index * tabWidth + 6,
    y: barTop + 8,
    width: tabWidth - 12,
    height: tabBarHeight - 16,
  });

  const { attach: attachStoryTile, rect: storyTileRect, onLayout: onStoryTileLayout } = useWindowRect();
  const { attach: attachSortBar, rect: sortBarRect, onLayout: onSortBarLayout } = useWindowRect();
  const { attach: attachHeader, rect: headerRect, onLayout: onHeaderLayout } = useWindowRect();
  const { attach: attachAppCard, rect: appCardRect, onLayout: onAppCardLayout } = useWindowRect();
  const { attach: attachGoalCard, rect: goalCardRect, onLayout: onGoalCardLayout } = useWindowRect();

  const ring: WindowRect | null = (() => {
    if (sheet !== null) return null;
    switch (step) {
      case 2: return circle(rail.heart, RAIL_MARK);
      case 3: return circle(rail.comment, RAIL_MARK);
      case 5: return circle(rail.bolt, RAIL_RING);
      case 6: return tabRect(0);
      case 7: return storyTileRect ? { ...storyTileRect, radius: radius.lg + 5.5 } : null;
      case 8: return sortBarRect ? { ...sortBarRect, x: sortBarRect.x + 10, width: sortBarRect.width - 20, radius: 22 } : null;
      case 9:
        return headerRect
          ? { x: headerRect.x + headerRect.width - 44, y: headerRect.y + (headerRect.height - 44) / 2, width: 44, height: 44 }
          : null;
      case 11: return tabRect(2);
      case 12: return appCardRect ? { ...appCardRect, radius: radius.lg } : null;
      case 13: return goalCardRect ? { ...goalCardRect, radius: radius.lg + 2 } : null;
      default: return null;
    }
  })();

  // ── the end: pay, then hand over ──
  const [paid, setPaid] = useState<number | null>(null);
  const [payError, setPayError] = useState(false);
  const [before, setBefore] = useState(credits.balance);
  const paying = useRef(false);

  const pay = useCallback(async () => {
    if (paying.current) return;
    paying.current = true;
    setPayError(false);
    setBefore(credits.balance);
    try {
      const amount = await completeTour();
      setPaid(amount);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void credits.refresh();
    } catch (error) {
      reportError(error, { where: 'tour.complete' });
      setPayError(true);
    } finally {
      paying.current = false;
    }
  }, [credits]);

  const finish = useCallback(() => {
    if (!user) return;
    markTourFinished();
    // The guard in the root layout reads this; flipping it is what swaps the tour for the app.
    queryClient.setQueryData<Profile>(profileKey(user.id), (current) =>
      current ? { ...current, user: { ...current.user, tourCompletedAt: new Date().toISOString() } } : current,
    );
  }, [queryClient, user]);

  // ── scenes ──
  const onDeck = step <= 6;
  const onHome = step >= 7 && step <= 11;
  const onActivity = step === 12 || step === 13;
  const tabsVisible = step >= 6 && step <= 13 && sheet === null;
  const tabIndex = onHome ? 0 : onActivity ? 2 : 1;

  const onDeckScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (step === 1 && event.nativeEvent.contentOffset.y > H / 2) advance(2);
  };

  const nvidia = { ...PRACTICE_NVIDIA, isLiked: liked };
  const goal = useMemo(() => practiceGoal(), []);

  const coach = COACH[step];
  const coachPosition =
    step <= 5
      ? { left: screenPadding, right: 80, bottom: insets.bottom + spacing.lg }
      : step === 8 || step === 12
        ? { left: screenPadding, right: screenPadding, top: insets.top + 44 }
        : { left: screenPadding, right: screenPadding, bottom: H - barTop + spacing.md };

  return (
    <TabBarVisibilityProvider>
      <View style={styles.screen}>
        {onDeck ? (
          <FlatList
            data={[PRACTICE_APPLE, nvidia]}
            keyExtractor={(job) => job.id}
            pagingEnabled
            scrollEnabled={step === 1}
            showsVerticalScrollIndicator={false}
            onMomentumScrollEnd={onDeckScrollEnd}
            initialScrollIndex={step >= 2 ? 1 : 0}
            getItemLayout={(_, index) => ({ length: H, offset: H * index, index })}
            renderItem={({ item }) => {
              const isNvidia = item.id === PRACTICE_NVIDIA.id;
              return (
                <JobReelCard
                  job={item}
                  height={H}
                  paddingTop={cardPaddingTop}
                  paddingBottom={cardPaddingBottom}
                  logoUrl={item.companyLogoUrl ?? undefined}
                  logoColor={item.companyLogoColor ?? undefined}
                  commentCount={11}
                  likeCount={isNvidia && liked ? 1241 : 1240}
                  onLike={() => {
                    if (!isNvidia || step !== 2) return;
                    setLiked(true);
                    advance(3, 900);
                  }}
                  onComment={() => {
                    if (isNvidia && step === 3) setSheet('comments');
                  }}
                  onMore={() => undefined}
                  onAutoApply={() => {
                    if (isNvidia && step === 5) setSheet('apply');
                  }}
                  onCompanyPress={() => undefined}
                  isFollowing={isNvidia && followed}
                  onToggleFollow={() => {
                    if (!isNvidia || step !== 4) return;
                    setFollowed(true);
                    advance(5, 650);
                  }}
                  autoApplyCredits={credits.balance}
                />
              );
            }}
          />
        ) : null}

        {onHome ? (
          <Animated.View entering={FadeIn.duration(220)} style={StyleSheet.absoluteFill}>
            <ScrollView scrollEnabled={false} contentContainerStyle={[styles.home, { paddingTop: insets.top + 40 }]}>
              <View style={styles.homeTop}>
                <View ref={attachHeader} onLayout={onHeaderLayout}>
                  <HomeHeader
                    firstName={greetingNameOf(user)}
                    handle={user?.handle || null}
                    onProfilePress={() => {
                      if (step === 9) setSheet('me');
                    }}
                  />
                </View>
                <SearchBar onPress={() => undefined} />
              </View>

              <View>
                <View style={styles.padded}>
                  <SectionHeader title="News" />
                </View>
                <View style={styles.storyRow}>
                  {PRACTICE_STORY_ROW.map((group, index) =>
                    index === 0 ? (
                      <View key={group.id} ref={attachStoryTile} onLayout={onStoryTileLayout}>
                        <StoryTile
                          group={group}
                          onPress={() => {
                            if (step === 7) setSheet('story');
                          }}
                        />
                      </View>
                    ) : (
                      <StoryTile key={group.id} group={group} onPress={() => undefined} />
                    ),
                  )}
                </View>
              </View>

              <View style={styles.feedSection}>
                <View style={styles.padded}>
                  <SectionHeader title="Your Feed" />
                </View>
                <View ref={attachSortBar} onLayout={onSortBarLayout}>
                  <FeedSortBar
                    sort={sort}
                    onChange={(next) => {
                      if (step !== 8 || next !== 'salary') return;
                      setSort('salary');
                      advance(9, 1100);
                    }}
                  />
                </View>
                <View style={styles.feedList}>
                  {(sort === 'salary' ? PRACTICE_FEED_SALARY : PRACTICE_FEED_RELEVANT).map((job) => (
                    <Animated.View key={job.id} entering={FadeIn.duration(250)}>
                      <JobFeedCard
                        job={job}
                        logoUrl={job.companyLogoUrl ?? undefined}
                        logoColor={job.companyLogoColor ?? undefined}
                        onPress={() => undefined}
                        onToggleLike={() => undefined}
                      />
                    </Animated.View>
                  ))}
                </View>
              </View>
            </ScrollView>
          </Animated.View>
        ) : null}

        {onActivity ? (
          <Animated.View entering={FadeIn.duration(220)} style={StyleSheet.absoluteFill}>
            <ScrollView scrollEnabled={false} contentContainerStyle={[styles.activity, { paddingTop: insets.top + 40 }]}>
              <ActivityHeader
                counts={{
                  applied: stage === 'applied' ? 1 : 0,
                  interview: stage === 'interview' ? 1 : 0,
                  offer: 0,
                  closed: 0,
                  active: 1,
                  total: 1,
                }}
              />
              <StatStrip
                items={[
                  { key: 'streak', value: 0, label: 'week streak' },
                  { key: 'applications', value: 1, label: 'application' },
                  { key: 'auto', value: 1, label: 'auto apply' },
                  { key: 'following', value: 1, label: 'following' },
                ]}
              />
              <View ref={attachGoalCard} onLayout={onGoalCardLayout}>
                <WeeklyGoalCard goal={goal} onEditGoal={() => undefined} />
              </View>
              <ActivityTabs
                tab="applications"
                counts={{ applications: 1, liked: 1, comments: 0 }}
                unreadComments={0}
                onChange={() => undefined}
              />
              <View ref={attachAppCard} onLayout={onAppCardLayout}>
                <ApplicationCard
                  entry={practiceApplication(stage)}
                  onPress={() => undefined}
                  onOpenStatusPicker={() => undefined}
                  onAdvance={(next) => {
                    if (step !== 12 || next !== 'interview') return;
                    setStage('interview');
                    advance(13, 900);
                  }}
                />
              </View>
            </ScrollView>
          </Animated.View>
        ) : null}

        {step >= 1 && step <= STEPS && sheet !== 'story' && sheet !== 'me' ? (
          <TourTopBar step={step} total={STEPS} top={insets.top + 8} deckReady={deckReady} />
        ) : null}

        {tabsVisible ? (
          <Animated.View entering={FadeIn.duration(250)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <FloatingTabBar
              state={{ index: tabIndex, routes: TAB_ROUTES }}
              descriptors={TAB_TITLES}
              navigation={{
                emit: () => ({ defaultPrevented: false }),
                navigate: (name: string) => {
                  if (name === 'index' && step === 6) advance(7);
                  if (name === 'activity' && step === 11) advance(12);
                },
              }}
            />
          </Animated.View>
        ) : null}

        {ring ? <PulseRing rect={ring} /> : null}

        {step === 1 ? <SwipeHint bottom={insets.bottom + 190} /> : null}

        {coach && sheet === null ? (
          <CoachBubble
            key={step}
            kicker={coach[0]}
            title={coach[1]}
            body={coach[2]}
            position={coachPosition}
            accessory={step === 10 ? <ThemeSwitch /> : undefined}
            action={
              step === 10
                ? { label: 'Continue', onPress: () => advance(11) }
                : step === 13
                  ? {
                      label: 'Got it',
                      onPress: () => {
                        advance(REWARD);
                        void pay();
                      },
                    }
                  : undefined
            }
          />
        ) : null}

        {sheet === 'comments' ? (
          <PracticeComments
            onDone={() => {
              setSheet(null);
              advance(4);
            }}
          />
        ) : null}

        {sheet === 'apply' ? (
          <PracticeAutoApply
            companyName={PRACTICE_NVIDIA.companyName}
            onDone={() => {
              setSheet(null);
              advance(6);
            }}
          />
        ) : null}

        {sheet === 'story' ? (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
            <StoryStage
              width={W}
              onClose={() => {
                setSheet(null);
                advance(8);
              }}
            />
          </Animated.View>
        ) : null}

        {sheet === 'me' ? (
          <AvatarReveal
            handle={user?.handle || 'careerdeck'}
            onDone={() => {
              setSheet(null);
              advance(10);
            }}
          />
        ) : null}

        {step === 0 ? <Welcome onStart={() => advance(1)} /> : null}

        {step === REWARD ? (
          <TourReward
            paid={paid}
            before={before}
            error={payError}
            onRetry={() => void pay()}
            onStart={finish}
          />
        ) : null}

      </View>
    </TabBarVisibilityProvider>
  );
}

/** The real story page, on the practice story. Its progress bar holds still, part-way. */
function StoryStage({ width, onClose }: { width: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0.35);
  const dragY = useSharedValue(0);
  return (
    <StoryPage
      group={PRACTICE_STORY}
      itemIndex={0}
      width={width}
      insets={insets}
      progress={progress}
      dragY={dragY}
      onNext={() => undefined}
      onPrevious={() => undefined}
      onHoldChange={() => undefined}
      onClose={onClose}
      onReadSource={() => undefined}
      isFollowing={false}
      onToggleFollow={() => undefined}
    />
  );
}

function SwipeHint({ bottom }: { bottom: number }) {
  const pro = usePaywallColors();
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    y.set(
      withRepeat(
        withSequence(
          withTiming(-12, { duration: 650, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 650, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    );
  }, [y, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.swipeHint, { bottom }, style]}>
      <Ionicons name="chevron-up" size={28} color={pro.violet} />
      <Text style={[styles.swipeLabel, { color: pro.violet }]}>SWIPE UP</Text>
    </Animated.View>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const pro = usePaywallColors();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)} style={styles.welcome}>
      <View style={[styles.welcomeBody, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <View style={styles.welcomeMark}>
          <Svg width={64} height={64} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="welcomeRing" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={pro.violet} />
                <Stop offset="0.55" stopColor={pro.magenta} />
                <Stop offset="1" stopColor={pro.gold} />
              </LinearGradient>
            </Defs>
            <Circle cx={32} cy={32} r={30.5} stroke="url(#welcomeRing)" strokeWidth={2.5} fill="none" />
          </Svg>
          <Ionicons name="flash-outline" size={28} color={colors.text} />
        </View>
        <Text style={styles.welcomeTitle}>A 2-minute practice run</Text>
        <Text style={styles.welcomeLead}>
          Learn the Deck, Home and Activity, and meet the anonymous you. Finish and we&apos;ll add{' '}
          <Text style={styles.welcomeStrong}>3 free Auto Applies</Text> to your account.
        </Text>
        <Text style={styles.welcomeNote}>Your real deck is being built while you practice.</Text>
        <Pressable
          onPress={onStart}
          accessibilityRole="button"
          style={({ pressed }) => [styles.welcomeButton, pressed ? styles.pressed : null]}>
          <Text style={styles.welcomeButtonLabel}>Start practice</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  home: {
    gap: spacing.xl,
  },
  homeTop: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  padded: {
    paddingHorizontal: screenPadding,
  },
  storyRow: {
    flexDirection: 'row',
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  feedSection: {
    gap: spacing.md,
  },
  feedList: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  activity: {
    paddingHorizontal: screenPadding,
    gap: spacing.xl,
  },
  swipeHint: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 2,
  },
  swipeLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  welcome: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    opacity: 0.97,
    justifyContent: 'flex-end',
  },
  welcomeBody: {
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  welcomeMark: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTitle: {
    fontSize: fontSize.display,
    lineHeight: 35,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: colors.text,
  },
  welcomeLead: {
    fontSize: fontSize.body + 1,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  welcomeStrong: {
    fontWeight: '700',
    color: colors.text,
  },
  welcomeNote: {
    fontSize: fontSize.body - 1,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  welcomeButton: {
    marginTop: spacing.sm,
    height: 56,
    borderRadius: radius.lg - 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  welcomeButtonLabel: {
    fontSize: fontSize.body + 2,
    fontWeight: '700',
    color: colors.background,
  },
  pressed: {
    opacity: 0.8,
  },
}));
