import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityTabs, type ActivityTab } from '@/components/activity/ActivityTabs';
import { ApplicationCard } from '@/components/activity/ApplicationCard';
import { CommentActivityCard } from '@/components/activity/CommentActivityCard';
import { ResumeShelf } from '@/components/activity/ResumeShelf';
import { ResumeViewerModal } from '@/components/activity/ResumeViewerModal';
import { StatusPickerSheet } from '@/components/activity/StatusPickerSheet';
import { WeeklyGoalCard } from '@/components/activity/WeeklyGoalCard';
import { EmptyState } from '@/components/common/EmptyState';
import { GoalPickerSheet } from '@/components/common/GoalPickerSheet';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { usePipelineCounts, useTrackedApplications } from '@/hooks/useApplications';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useJobsByIds } from '@/hooks/useJobFeeds';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { ApplicationStatus, Job } from '@/types';

/** Per-row stagger on a list's entrance, capped so a long list's tail isn't left waiting. */
const STAGGER_MS = 45;
const MAX_STAGGER_INDEX = 7;

/**
 * Activity is the record of a recruiting season: the applications being tracked, the
 * postings set aside to come back to, and what people said in reply to the user.
 *
 * The tracker is self-reported on purpose. CareerDeck hands users off to Greenhouse,
 * Workday and the rest to actually apply — it has no way to read a submission back out
 * of an employer's system — so stages are whatever the user says they are, and the UI
 * says so rather than implying a live integration that doesn't exist.
 */
export default function ActivityScreen() {
  const router = useRouter();
  const styles = useStyles();
  const {
    isInitialLoading,
    likedJobIds,
    resumes,
    defaultResumeId,
    commentActivity,
    unreadCommentCount,
    toggleSave,
    setDefaultResume,
    setApplicationStatus,
    markCommentActivityRead,
    markAllCommentActivityRead,
    weeklyGoal,
    setWeeklyGoal,
  } = useCareerDeck();

  const applications = useTrackedApplications();
  const counts = usePipelineCounts();
  const goal = useWeeklyGoal();
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const [tab, setTab] = useState<ActivityTab>('applications');
  const [viewingResumeId, setViewingResumeId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);

  const viewingResume = resumes.find((resume) => resume.id === viewingResumeId) ?? null;
  const pickerEntry = applications.find((entry) => entry.application.id === pickerFor) ?? null;

  /*
   * Liked postings are resolved by id rather than filtered out of a loaded feed.
   *
   * The old version searched `jobs` — the whole corpus, in memory. With a paginated
   * feed that array is one page, so a job liked yesterday and scrolled past would
   * silently vanish from this tab. Phase 2 replaces the id set with a read of
   * `job_interactions`; the shape of this call does not change.
   */
  const { jobs: likedJobs } = useJobsByIds(likedJobIds);

  /*
   * Comment activity points at mock job ids, and those postings no longer exist —
   * PHASE1.md §8.6. The card falls back to "A posting" rather than rendering blank,
   * and phase 3's real `comments` table gives it something to resolve again.
   */
  const jobById = useMemo(() => new Map(likedJobs.map((job) => [job.id, job])), [likedJobs]);

  // The unread badge clears a beat after the list is opened, rather than the instant
  // the tab is pressed — long enough that the user sees which rows were new.
  // markAllCommentActivityRead returns the same array when nothing is unread, so this
  // settles after one pass instead of re-triggering itself.
  useEffect(() => {
    if (tab !== 'comments') return;
    const timer = setTimeout(markAllCommentActivityRead, 1200);
    return () => clearTimeout(timer);
  }, [tab, commentActivity, markAllCommentActivityRead]);

  const tabCounts: Record<ActivityTab, number> = {
    applications: applications.length,
    liked: likedJobs.length,
    comments: commentActivity.length,
  };

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });

  const handleSelectStatus = (status: ApplicationStatus) => {
    if (pickerEntry) setApplicationStatus(pickerEntry.application.id, status);
    setPickerFor(null);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + tabBarHeight }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            Activity
          </Text>
          <Text style={styles.subtitle}>
            {counts.active} in play {'·'} {counts.closed} closed out
          </Text>
        </View>

        <WeeklyGoalCard goal={goal} onEditGoal={() => setEditingGoal(true)} />

        <ResumeShelf
          resumes={resumes}
          defaultResumeId={defaultResumeId}
          loading={isInitialLoading}
          onView={setViewingResumeId}
        />

        <ActivityTabs
          tab={tab}
          counts={tabCounts}
          unreadComments={unreadCommentCount}
          onChange={setTab}
        />

        {/* Keyed on the tab so each list runs its own entrance, rather than swapping
            rows out underneath a container that never changes. */}
        <Animated.View key={tab} entering={FadeIn.duration(220)} style={styles.list}>
          {tab === 'applications' ? (
            applications.length > 0 ? (
              applications.map((entry, index) => (
                <Animated.View
                  key={entry.application.id}
                  entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                  <ApplicationCard
                    entry={entry}
                    onPress={() => handlePressJob(entry.job)}
                    onAdvance={(status) => setApplicationStatus(entry.application.id, status)}
                    onOpenStatusPicker={() => setPickerFor(entry.application.id)}
                  />
                </Animated.View>
              ))
            ) : (
              <EmptyState
                icon="paper-plane-outline"
                title="No applications yet"
                message="Apply to a posting and mark it here to start tracking your season."
              />
            )
          ) : null}

          {tab === 'liked' ? (
            likedJobs.length > 0 ? (
              likedJobs.map((job, index) => (
                <Animated.View
                  key={job.id}
                  entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                  <JobFeedCard
                    job={job}
                    logoColor={job.companyLogoColor ?? undefined}
                    logoUrl={job.companyLogoUrl ?? undefined}
                    onPress={() => handlePressJob(job)}
                    onToggleSave={() => toggleSave(job.id)}
                  />
                </Animated.View>
              ))
            ) : (
              <EmptyState
                icon="heart-outline"
                title="Nothing liked yet"
                message="Double-tap a card in Deck and it'll be waiting here."
              />
            )
          ) : null}

          {tab === 'comments' ? (
            commentActivity.length > 0 ? (
              commentActivity.map((entry, index) => {
                const job = jobById.get(entry.jobId);
                return (
                  <Animated.View
                    key={entry.id}
                    entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                    <CommentActivityCard
                      entry={entry}
                      jobTitle={job?.title ?? 'A posting'}
                      companyName={job?.companyName ?? ''}
                      onPress={() => {
                        markCommentActivityRead(entry.id);
                        if (job) handlePressJob(job);
                      }}
                    />
                  </Animated.View>
                );
              })
            ) : (
              <EmptyState
                icon="chatbubbles-outline"
                title="No replies yet"
                message="Comment on a posting in Deck and replies to it land here."
              />
            )
          ) : null}
        </Animated.View>
      </Animated.ScrollView>

      <StatusPickerSheet
        visible={pickerEntry !== null}
        current={pickerEntry?.application.status ?? null}
        jobTitle={pickerEntry ? `${pickerEntry.job.title} · ${pickerEntry.job.companyName}` : ''}
        onSelect={handleSelectStatus}
        onClose={() => setPickerFor(null)}
      />

      <GoalPickerSheet
        visible={editingGoal}
        current={weeklyGoal}
        countThisWeek={goal.count}
        onSelect={(target) => {
          setWeeklyGoal(target);
          setEditingGoal(false);
        }}
        onClose={() => setEditingGoal(false)}
      />

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

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: screenPadding,
    gap: spacing.xl,
  },
  heading: {
    paddingTop: spacing.sm,
    gap: 2,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.7,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  list: {
    gap: spacing.md,
  },
}));
