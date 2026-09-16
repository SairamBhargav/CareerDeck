import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { EmptyState } from '@/components/common/EmptyState';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SkillChip } from '@/components/common/SkillChip';
import { ApplicationModal } from '@/components/jobs/ApplicationModal';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { colors, fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useJobById } from '@/hooks/useJobFeeds';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, companies, toggleSave, toggleLike } = useCareerDeck();
  const job = useJobById(id);
  const [applyVisible, setApplyVisible] = useState(false);

  if (!job) {
    return (
      <View style={styles.missing}>
        <EmptyState
          icon="alert-circle-outline"
          title="Job not found"
          message="This posting is no longer part of the current feed."
        />
      </View>
    );
  }

  const logoColor = companies.find((company) => company.id === job.companyId)?.logoColor;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.companyRow}>
          <CompanyLogo logo={job.companyLogo} name={job.companyName} color={logoColor} size="lg" />
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
        user={user}
        visible={applyVisible}
        onClose={() => setApplyVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
});
