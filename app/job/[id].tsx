import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { EmptyState } from '@/components/common/EmptyState';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SkillChip } from '@/components/common/SkillChip';
import { ApplicationModal } from '@/components/jobs/ApplicationModal';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useJobById } from '@/hooks/useJobFeeds';

export default function JobDetailScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { defaultResume, toggleSave, toggleLike } = useCareerDeck();
  const { job, isLoading } = useJobById(id);
  const [applyVisible, setApplyVisible] = useState(false);

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
        <View style={styles.companyRow}>
          <CompanyLogo
            logo={job.companyLogoUrl ?? job.companyLogo}
            name={job.companyName}
            color={job.companyLogoColor ?? undefined}
            size="lg"
          />
          <Text style={styles.company}>{job.companyName}</Text>
        </View>

        <Text style={styles.title}>{job.title}</Text>
        <JobMetadata job={job} emphasizeSalary />

        <Text style={styles.sectionTitle}>About the role</Text>
        <Text style={styles.body}>{job.description}</Text>

        <Text style={styles.sectionTitle}>What they look for</Text>
        {job.requirements.map((requirement) => (
          <View key={requirement} style={styles.bulletRow}>
            <Text style={styles.bullet}>{'•'}</Text>
            <Text style={styles.body}>{requirement}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Skills</Text>
        <View style={styles.skills}>
          {job.skills.map((skill) => (
            <SkillChip key={skill} label={skill} />
          ))}
        </View>

        <View style={styles.actions}>
          <PrimaryButton label="Apply" onPress={() => setApplyVisible(true)} />
          <PrimaryButton
            label={job.isSaved ? 'Saved' : 'Save'}
            variant="secondary"
            onPress={() => toggleSave(job.id)}
          />
          <PrimaryButton
            label={job.isLiked ? 'Liked' : 'Like'}
            variant="ghost"
            onPress={() => toggleLike(job.id)}
          />
        </View>
      </ScrollView>

      <ApplicationModal
        job={job}
        resumeName={defaultResume?.name ?? ''}
        visible={applyVisible}
        onClose={() => setApplyVisible(false)}
      />
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
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.xl,
  },
  body: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bullet: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textTertiary,
  },
  skills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xxl,
  },
}));
