import * as DocumentPicker from 'expo-document-picker';
/*
 * The explicit legacy entry point, not the bare `expo-file-system` import.
 *
 * SDK 57 split the package: the default export is the new class-based `File`/`Directory`
 * API, and `readAsStringAsync`/`EncodingType` moved to `expo-file-system/legacy`. Importing
 * them from the bare module still works today through a deprecation-warning shim, but that
 * shim is the part scheduled to go away — the legacy subpath itself is the stable, supported
 * way to keep using the functional API. One import, everything below is unchanged.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityHeader } from '@/components/activity/ActivityHeader';
import { ActivityTabs, type ActivityTab } from '@/components/activity/ActivityTabs';
import { ApplicationCard } from '@/components/activity/ApplicationCard';
import { MyCommentCard } from '@/components/activity/MyCommentCard';
import { NotificationCard } from '@/components/activity/NotificationCard';
import { ProCard } from '@/components/activity/ProCard';
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
import { useGuardedRouter } from '@/hooks/useGuardedRouter';
import { usePipelineCounts, useTrackedApplications } from '@/hooks/useApplications';
import { useMyComments } from '@/hooks/useComments';
import { useResumes } from '@/hooks/useResumes';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useJobsByIds } from '@/hooks/useJobFeeds';
import { useOpenCompany } from '@/hooks/useOpenCompany';
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
  const router = useGuardedRouter();
  const styles = useStyles();
  const {
    isInitialLoading,
    likedJobIds,
    user,
    notifications,
    unreadNotificationCount,
    toggleLike,
    setApplicationStatus,
    markNotificationRead,
    markAllNotificationsRead,
    weeklyGoal,
    setWeeklyGoal,
    credits,
  } = useCareerDeck();

  const {
    resumes,
    isLoading: resumesLoading,
    isBusy: resumesBusy,
    canParse,
    upload,
    parse,
    setDefault,
    openUrl,
  } = useResumes(user?.id ?? null);

  const applications = useTrackedApplications();
  const counts = usePipelineCounts();
  const goal = useWeeklyGoal();
  const tabBarHeight = useTabBarHeight();
  const openCompany = useOpenCompany();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const [tab, setTab] = useState<ActivityTab>('applications');
  const [viewingResumeId, setViewingResumeId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);

  const viewingResume = resumes.find((resume) => resume.id === viewingResumeId) ?? null;

  /*
   * Pick a PDF, upload it, parse it, and land on the review screen.
   *
   * Four steps behind one tap, and the ordering is the part worth keeping: the row is created
   * before the parse runs, so a parse that fails leaves a resume the user can retry rather than
   * nothing at all. `useResumes` refetches on either outcome for the same reason — a failed
   * parse writes the reason onto the row, and that row is the only place the user learns it.
   */
  const handleAddResume = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;

    const file = picked.assets[0];
    if (!file) return;

    try {
      /*
       * Base64 out of the cache and back into bytes. `fetch(file.uri)` would be shorter and is
       * unreliable for `file://` URIs across platforms here; reading it explicitly is the path
       * that behaves the same on both.
       */
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = globalThis.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const { resume: created, reused } = await upload({
        name: (file.name ?? 'Resume').replace(/\.pdf$/i, '').slice(0, 120) || 'Resume',
        bytes: bytes.buffer,
      });

      /*
       * Already on the shelf, byte for byte — so straight to the review screen without a
       * parse. Re-reading a document the database already holds a profile for is a model call
       * for an answer we have, and it is the single easiest cost in the app to avoid.
       *
       * Still navigate: the user asked to add this resume, and the honest response is to show
       * them the one they already have rather than appear to do nothing.
       */
      if (reused) {
        router.push({ pathname: '/resume-review', params: { id: created.id } });
        return;
      }

      if (!canParse) {
        // No API service on this build, so there is nothing to review. The file is stored and
        // the shelf says "Not read yet", which is exactly what has happened.
        return;
      }

      await parse(created.id);
      router.push({ pathname: '/resume-review', params: { id: created.id } });
    } catch (error) {
      Alert.alert(
        'That resume did not upload',
        error instanceof Error ? error.message : 'Something went wrong. Try again.',
      );
    }
  }, [upload, parse, canParse, router]);
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
   * The postings the inbox points at.
   *
   * Through phase 2 this reused the liked-jobs list, because comment activity was a fixture
   * pointing at mock ids that no longer existed (PHASE1.md §8.6) and there was nothing to resolve.
   * Real notifications carry a real `jobId`, so they are resolved by id — the same
   * `useJobsByIds` the liked tab uses, which is already a batched read.
   */
  const notificationJobIds = useMemo(
    () => [...new Set(notifications.map((entry) => entry.jobId).filter((id): id is string => id !== null))],
    [notifications],
  );
  const { jobs: notificationJobs } = useJobsByIds(notificationJobIds);
  const jobById = useMemo(
    () => new Map([...likedJobs, ...notificationJobs].map((job) => [job.id, job])),
    [likedJobs, notificationJobs],
  );

  // The unread badge clears a beat after the list is opened, rather than the instant the tab is
  // pressed — long enough that the user sees which rows were new. `markAllNotificationsRead` is a
  // no-op when nothing is unread, so this settles after one pass instead of re-triggering itself.
  useEffect(() => {
    if (tab !== 'comments') return;
    const timer = setTimeout(markAllNotificationsRead, 1200);
    return () => clearTimeout(timer);
  }, [tab, notifications, markAllNotificationsRead]);

  // Fetched as soon as the screen mounts, so the tab's count is right before anybody opens it.
  const myComments = useMyComments(true);

  const tabCounts: Record<ActivityTab, number> = {
    applications: applications.length,
    liked: likedJobs.length,
    comments: myComments.comments.length,
  };

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });
  // Straight into the thread: from a comment, the comments are what you came back for.
  const openThread = (jobId: string) =>
    router.push({ pathname: '/job/[id]', params: { id: jobId, comments: '1' } });

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
        <ActivityHeader counts={counts} />

        <WeeklyGoalCard goal={goal} onEditGoal={() => setEditingGoal(true)} />

        {/* Pro's standing place in the app. Gone once they subscribe. */}
        {credits.isPro ? null : (
          <ProCard onPress={() => router.push({ pathname: '/paywall', params: { from: 'activity' } })} />
        )}

        <ResumeShelf
          resumes={resumes}
          loading={isInitialLoading || resumesLoading}
          onView={setViewingResumeId}
          onAdd={handleAddResume}
          busy={resumesBusy}
        />

        <ActivityTabs
          tab={tab}
          counts={tabCounts}
          unreadComments={unreadNotificationCount}
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
                    onCompanyPress={() => openCompany(entry.job.companySlug)}
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
                    onToggleLike={() => toggleLike(job.id)}
                    onCompanyPress={() => openCompany(job.companySlug)}
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
            notifications.length === 0 && myComments.comments.length === 0 ? (
              <EmptyState
                icon="chatbubbles-outline"
                title={myComments.isLoading ? 'Loading…' : 'No comments yet'}
                message="Ask about the interview, the team, the timeline. Your comments, and the replies they get, land here."
              />
            ) : (
              <>
                {notifications.length > 0 ? (
                  <Text style={styles.section} accessibilityRole="header">
                    Updates
                  </Text>
                ) : null}
                {notifications.map((entry, index) => {
                  const job = entry.jobId === null ? undefined : jobById.get(entry.jobId);
                  return (
                    <Animated.View
                      key={entry.id}
                      entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                      <NotificationCard
                        entry={entry}
                        // A posting that has since closed and been swept is a real case, not an
                        // error: the notification still reads, it just cannot be opened.
                        jobTitle={job?.title ?? 'A posting'}
                        companyName={job?.companyName ?? ''}
                        onPress={() => {
                          markNotificationRead(entry.id);
                          if (entry.jobId !== null) openThread(entry.jobId);
                        }}
                      />
                    </Animated.View>
                  );
                })}

                {myComments.comments.length > 0 ? (
                  <Text style={styles.section} accessibilityRole="header">
                    Your comments
                  </Text>
                ) : null}
                {myComments.comments.map((comment, index) => (
                  <Animated.View
                    key={comment.id}
                    entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                    <MyCommentCard comment={comment} onPress={() => openThread(comment.jobId)} />
                  </Animated.View>
                ))}
                {myComments.hasMore ? (
                  <Pressable onPress={myComments.loadMore} accessibilityRole="button" style={styles.more}>
                    <Text style={styles.moreText}>Show older comments</Text>
                  </Pressable>
                ) : null}
              </>
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
        isDefault={viewingResume?.isDefault ?? false}
        visible={viewingResume !== null}
        onClose={() => setViewingResumeId(null)}
        onSetDefault={() => {
          if (viewingResume) void setDefault(viewingResume.id);
        }}
        onReviewParse={() => {
          if (!viewingResume) return;
          // Closed first: the review screen is a route, and leaving a full-screen modal over
          // it would put the PDF on top of the thing the user just asked to see.
          const id = viewingResume.id;
          setViewingResumeId(null);
          router.push({ pathname: '/resume-review', params: { id } });
        }}
        onRequestUrl={openUrl}
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
  list: {
    gap: spacing.md,
  },
  section: {
    marginTop: spacing.xs,
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  more: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  moreText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
