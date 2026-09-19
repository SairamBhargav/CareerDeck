import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityTabs, type ActivityTab } from '@/components/activity/ActivityTabs';
import { ApplicationCard } from '@/components/activity/ApplicationCard';
import { CompanyListRow } from '@/components/activity/CompanyListRow';
import { PipelineStrip } from '@/components/activity/PipelineStrip';
import { ResumeShelf } from '@/components/activity/ResumeShelf';
import { ResumeViewerModal } from '@/components/activity/ResumeViewerModal';
import { StatusPickerSheet } from '@/components/activity/StatusPickerSheet';
import { EmptyState } from '@/components/common/EmptyState';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { usePipelineCounts, useTrackedApplications } from '@/hooks/useApplications';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import type { ApplicationStatus, Company, Job } from '@/types';

/** Per-row stagger on a list's entrance, capped so a long list's tail isn't left waiting. */
const STAGGER_MS = 45;
const MAX_STAGGER_INDEX = 7;

/**
 * Activity is the record of everything the user has done: the applications they're
 * tracking, the jobs they set aside, and the companies they follow.
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
    companies,
    jobs,
    resumes,
    defaultResumeId,
    followedCompanyIds,
    toggleFollow,
    toggleSave,
    setDefaultResume,
    setApplicationStatus,
  } = useCareerDeck();

  const applications = useTrackedApplications();
  const counts = usePipelineCounts();
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const [tab, setTab] = useState<ActivityTab>('applications');
  const [viewingResumeId, setViewingResumeId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const viewingResume = resumes.find((resume) => resume.id === viewingResumeId) ?? null;
  const pickerEntry = applications.find((entry) => entry.application.id === pickerFor) ?? null;

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const followedCompanies = useMemo(
    () => companies.filter((company) => followedCompanyIds.includes(company.id)),
    [companies, followedCompanyIds],
  );
  const savedJobs = useMemo(() => jobs.filter((job) => job.isSaved), [jobs]);
  const likedJobs = useMemo(() => jobs.filter((job) => job.isLiked), [jobs]);

  const tabCounts: Record<ActivityTab, number> = {
    applications: applications.length,
    saved: savedJobs.length,
    liked: likedJobs.length,
    following: followedCompanies.length,
  };

  const handlePressJob = (job: Job) => router.push({ pathname: '/job/[id]', params: { id: job.id } });
  const handlePressCompany = (company: Company) =>
    router.push({ pathname: '/company/[id]', params: { id: company.id } });

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
            {counts.active} in play {'·'} {counts.total} total
          </Text>
        </View>

        <PipelineStrip counts={counts} />

        <ResumeShelf
          resumes={resumes}
          defaultResumeId={defaultResumeId}
          loading={isInitialLoading}
          onView={setViewingResumeId}
        />

        <ActivityTabs tab={tab} counts={tabCounts} onChange={setTab} />

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

          {tab === 'saved' ? (
            savedJobs.length > 0 ? (
              savedJobs.map((job, index) => (
                <Animated.View
                  key={job.id}
                  entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                  <JobFeedCard
                    job={job}
                    logoColor={companyById.get(job.companyId)?.logoColor}
                    logoUrl={companyById.get(job.companyId)?.logo}
                    onPress={() => handlePressJob(job)}
                    onToggleSave={() => toggleSave(job.id)}
                  />
                </Animated.View>
              ))
            ) : (
              <EmptyState
                icon="bookmark-outline"
                title="Nothing saved yet"
                message="Save a posting from Home or Deck to come back to it here."
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
                    logoColor={companyById.get(job.companyId)?.logoColor}
                    logoUrl={companyById.get(job.companyId)?.logo}
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

          {tab === 'following' ? (
            followedCompanies.length > 0 ? (
              followedCompanies.map((company, index) => (
                <Animated.View
                  key={company.id}
                  entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                  <CompanyListRow
                    company={company}
                    onPress={() => handlePressCompany(company)}
                    onToggleFollow={() => toggleFollow(company.id)}
                  />
                </Animated.View>
              ))
            ) : (
              <EmptyState
                icon="business-outline"
                title="Not following anyone yet"
                message="Follow companies on Home and their news shows up in your stories."
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
