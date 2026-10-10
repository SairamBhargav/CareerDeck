import Ionicons from '@expo/vector-icons/Ionicons';
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

import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityDoors } from '@/components/activity/ActivityDoors';
import { ApplicationCard } from '@/components/activity/ApplicationCard';
import { CheckInStack } from '@/components/activity/CheckInStack';
import { ProCard } from '@/components/activity/ProCard';
import { ResumeShelf } from '@/components/activity/ResumeShelf';
import { ResumeViewerModal } from '@/components/activity/ResumeViewerModal';
import { StageTiles } from '@/components/activity/StageTiles';
import { STATUS_LABEL } from '@/components/activity/StatusChip';
import { StatusPickerSheet } from '@/components/activity/StatusPickerSheet';
import { WeekStrip } from '@/components/activity/WeekStrip';
import { EmptyState } from '@/components/common/EmptyState';
import { GoalPickerSheet } from '@/components/common/GoalPickerSheet';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';
import { useTrackedApplications } from '@/hooks/useApplications';
import { daysQuiet, isQuiet, useCheckIns } from '@/hooks/useCheckIns';
import { useMyComments } from '@/hooks/useComments';
import { useResumes } from '@/hooks/useResumes';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useOpenCompany } from '@/hooks/useOpenCompany';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { ApplicationStatus, Job } from '@/types';
import { formatWeekLabel, parseLocalDate } from '@/utils/week';

/** Per-row stagger on a list's entrance, capped so a long list's tail isn't left waiting. */
const STAGGER_MS = 45;
const MAX_STAGGER_INDEX = 7;

/**
 * Activity is the record of a recruiting season: the applications being tracked, the
 * resumes they went out with, and the lists the reader keeps around them.
 *
 * The tracker is self-reported on purpose. CareerDeck hands users off to Greenhouse,
 * Workday and the rest to actually apply — it has no way to read a submission back out
 * of an employer's system — so stages are whatever the user says they are, and the UI
 * says so rather than implying a live integration that doesn't exist.
 *
 * The 2026-10-09 layout leans into that. The quick check-in asks about applications that
 * have gone quiet, so the tracker stays true without the reader having to remember to tend
 * it. Below it sit the resumes, then the season as four stage tiles that filter the list.
 * Liked, comments and following moved out of a tab bar into doors at the foot of the page,
 * and the reply inbox moved behind the bell, where its unread badge can be seen.
 */
export default function ActivityScreen() {
  const router = useGuardedRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const {
    isInitialLoading,
    likedJobIds,
    user,
    unreadNotificationCount,
    setApplicationStatus,
    weeklyGoal,
    setWeeklyGoal,
    credits,
    followedCompanySlugs,
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
  const checkIns = useCheckIns(applications);
  const goal = useWeeklyGoal();
  const tabBarHeight = useTabBarHeight();
  const openCompany = useOpenCompany();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const [stage, setStage] = useState<ApplicationStatus | null>(null);
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

  // Fetched on mount for the Comments door's count; the inbox screen shares the cache.
  const myComments = useMyComments(true);

  const shown = useMemo(
    () => (stage === null ? applications : applications.filter((entry) => entry.application.status === stage)),
    [applications, stage],
  );

  // "24 applications since Aug 12": the season's size, and when it started.
  const since = useMemo(() => {
    let oldest: Date | null = null;
    for (const entry of applications) {
      const applied = parseLocalDate(entry.application.appliedAt);
      if (applied && (!oldest || applied < oldest)) oldest = applied;
    }
    return oldest;
  }, [applications]);

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });

  const handleSelectStatus = (status: ApplicationStatus) => {
    if (pickerEntry) setApplicationStatus(pickerEntry.application.id, status);
    setPickerFor(null);
  };

  const applicationsLine =
    applications.length === 0
      ? 'Apply from the Deck and your season shows up here.'
      : `${applications.length} ${applications.length === 1 ? 'application' : 'applications'}` +
        (since ? ` since ${formatWeekLabel(since)}` : '');

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + tabBarHeight }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            {/* Home's greeting size, so the two tabs open at the same size and weight. */}
            <Text style={styles.title} accessibilityRole="header">
              Activity
            </Text>
            <Text style={styles.subtitle}>{applicationsLine}</Text>
          </View>

          <Pressable
            onPress={() => router.push({ pathname: '/inbox', params: { show: 'updates' } })}
            accessibilityRole="button"
            accessibilityLabel={
              unreadNotificationCount > 0 ? `Updates, ${unreadNotificationCount} unread` : 'Updates'
            }
            style={({ pressed }) => [styles.bell, pressed ? styles.bellPressed : null]}>
            <Ionicons name="notifications-outline" size={20} color={colors.text} />
            {unreadNotificationCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <WeekStrip goal={goal} onEditGoal={() => setEditingGoal(true)} />

        <CheckInStack
          queue={checkIns.queue}
          onSetStatus={setApplicationStatus}
          onSnooze={checkIns.snooze}
          onOpen={(entry) => handlePressJob(entry.job)}
        />

        <ResumeShelf
          resumes={resumes}
          loading={isInitialLoading || resumesLoading}
          onView={setViewingResumeId}
          onAdd={handleAddResume}
          busy={resumesBusy}
        />

        <StageTiles applications={applications} selected={stage} onSelect={setStage} />

        <View style={styles.listHeader}>
          <Text style={styles.listTitle} accessibilityRole="header">
            {stage === null ? 'All applications' : STATUS_LABEL[stage]}
            <Text style={styles.listCount}>{`  ${shown.length}`}</Text>
          </Text>
          {stage !== null ? (
            <Pressable onPress={() => setStage(null)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.listAction}>Show all</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Keyed on the filter so each list runs its own entrance, rather than swapping
            rows out underneath a container that never changes. */}
        <Animated.View key={stage ?? 'all'} entering={FadeIn.duration(220)} style={styles.list}>
          {shown.length > 0 ? (
            shown.map((entry, index) => (
              <Animated.View
                key={entry.application.id}
                entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                <ApplicationCard
                  entry={entry}
                  quietDays={isQuiet(entry) ? daysQuiet(entry) : undefined}
                  onPress={() => handlePressJob(entry.job)}
                  onAdvance={(status) => setApplicationStatus(entry.application.id, status)}
                  onOpenStatusPicker={() => setPickerFor(entry.application.id)}
                  onCompanyPress={() => openCompany(entry.job.companySlug)}
                />
              </Animated.View>
            ))
          ) : stage === null ? (
            <EmptyState
              icon="paper-plane-outline"
              title="No applications yet"
              message="Apply to a posting and mark it here to start tracking your season."
            />
          ) : (
            <EmptyState
              icon={stage === 'offer' ? 'trophy-outline' : 'file-tray-outline'}
              title={`Nothing in ${STATUS_LABEL[stage]}`}
              message="Applications land here as you move them along."
            />
          )}
        </Animated.View>

        <ActivityDoors
          doors={[
            {
              key: 'liked',
              icon: 'heart',
              tint: colors.like,
              title: `${likedJobIds.length} liked`,
              detail: 'Saved from the Deck',
              onPress: () => router.push({ pathname: '/collection/[type]', params: { type: 'liked' } }),
              accessibilityLabel: `${likedJobIds.length} liked jobs. Opens the list.`,
            },
            {
              key: 'comments',
              icon: 'chatbubble-outline',
              title: 'Comments',
              detail: myComments.isLoading
                ? 'Your threads'
                : `${myComments.comments.length}${myComments.hasMore ? '+' : ''} posted`,
              onPress: () => router.push({ pathname: '/inbox', params: { show: 'comments' } }),
              accessibilityLabel: 'Your comments. Opens the list.',
            },
            {
              key: 'following',
              icon: 'business-outline',
              title: `${followedCompanySlugs.length} following`,
              detail: 'Companies',
              onPress: () =>
                router.push({ pathname: '/collection/[type]', params: { type: 'following' } }),
              accessibilityLabel: `${followedCompanySlugs.length} companies followed. Opens the list.`,
            },
          ]}
        />

        {/* Pro's standing place in the app. Gone once they subscribe. */}
        {credits.isPro ? null : (
          <ProCard onPress={() => router.push({ pathname: '/paywall', params: { from: 'activity' } })} />
        )}
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
  // The Deck's muted canvas, so the cards on it read as cards without heavy borders.
  screen: {
    flex: 1,
    backgroundColor: colors.canvasMuted,
  },
  content: {
    paddingHorizontal: screenPadding,
    gap: spacing.lg + 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.7,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bellPressed: {
    backgroundColor: colors.backgroundMuted,
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.like,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textOnBrand,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: -spacing.sm,
  },
  listTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  listCount: {
    color: colors.textTertiary,
    fontWeight: '700',
  },
  listAction: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  list: {
    gap: spacing.sm + 2,
  },
}));
