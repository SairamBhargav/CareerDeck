import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { CommentSheet } from '@/components/comments/CommentSheet';
import { CompanyLogo } from '@/components/common/CompanyLogo';
import { EmptyState } from '@/components/common/EmptyState';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ApplicationModal } from '@/components/jobs/ApplicationModal';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { JobSectionsView } from '@/components/jobs/JobSectionsView';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useOpenCompany } from '@/hooks/useOpenCompany';
import { makeStyles } from '@/context/ThemeContext';
import { useCommentCounts } from '@/hooks/useComments';
import { useJobById } from '@/hooks/useJobFeeds';
import { useResumes } from '@/hooks/useResumes';

export default function JobDetailScreen() {
  const styles = useStyles();
  // `comments=1` arrives from Activity → Comments, which opens straight into the thread.
  const { id, comments } = useLocalSearchParams<{ id: string; comments?: string }>();
  const openCompany = useOpenCompany();
  const { user, toggleLike } = useCareerDeck();
  const { defaultResume } = useResumes(user?.id ?? null);
  const { job, isLoading } = useJobById(id);
  const [applyVisible, setApplyVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(comments === '1');
  const commentCount = useCommentCounts(id ? [id] : []).get(id ?? '') ?? 0;

  if (isLoading) {
    return (
      <View style={styles.missing}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!job) {
    /*
     * "Not found" now means something specific: RLS only exposes `status = 'open'`, so a
     * posting the employer has closed since it was last crawled 404s here rather than
     * rendering a dead Apply button. §16 lists stale postings as a top-tier trust risk,
     * and this is the last line of that defence.
     */
    return (
      <View style={styles.missing}>
        <EmptyState
          icon="alert-circle-outline"
          title="This posting has closed"
          message="The employer has taken it down, or it is no longer listed on their board."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Was a plain View, which left the one screen entirely about a job with no way
            to reach the company that posted it. */}
        <Pressable
          onPress={() => openCompany(job.companySlug)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${job.companyName}`}
          hitSlop={6}
          style={styles.companyRow}>
          <CompanyLogo
            logo={job.companyLogoUrl ?? job.companyLogo}
            name={job.companyName}
            color={job.companyLogoColor ?? undefined}
            size="lg"
          />
          <Text style={styles.company}>{job.companyName}</Text>
        </Pressable>

        <Text style={styles.title}>{job.title}</Text>
        <JobMetadata job={job} emphasizeSalary />

        <JobSectionsView job={job} />

        <View style={styles.actions}>
          <PrimaryButton label="Apply" onPress={() => setApplyVisible(true)} />
          {/* Save used to sit between these two, doing the same job as Like with a
              different word on it. */}
          <PrimaryButton
            label={job.isLiked ? 'Liked' : 'Like'}
            variant="secondary"
            onPress={() => toggleLike(job.id)}
          />
          <PrimaryButton
            label={commentCount === 0 ? 'Comments' : commentCount === 1 ? '1 comment' : `${commentCount} comments`}
            variant="ghost"
            onPress={() => setCommentsVisible(true)}
          />
        </View>
      </ScrollView>

      <ApplicationModal
        job={job}
        resumeName={defaultResume?.name ?? ''}
        visible={applyVisible}
        onClose={() => setApplyVisible(false)}
      />

      {/* Mounted only while open: the sheet slides in on mount and resets its composer per open. */}
      {commentsVisible ? (
        <CommentSheet job={job} visible onClose={() => setCommentsVisible(false)} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    padding: screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  company: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
    marginTop: spacing.md,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
}));
