import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SkillChip } from '@/components/common/SkillChip';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Job } from '@/types';
import { formatPostedAt } from '@/utils/format';

interface JobDetailsModalProps {
  job: Job | null;
  logoColor?: string;
  /** Company's real logo image, when available — falls back to job.companyLogo's monogram. */
  logoUrl?: string;
  visible: boolean;
  onClose: () => void;
  onApply: () => void;
}

/**
 * Full-height sheet opened from a reel's "More" action — every field the compact card
 * truncates or omits (full description, every requirement, every skill), plus a way to
 * jump straight into applying without going back to the reel first.
 */
export function JobDetailsModal({ job, logoColor, logoUrl, visible, onClose, onApply }: JobDetailsModalProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  if (!job) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close job details" />

      <View style={[styles.sheet, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.topBar}>
          <View style={styles.grabber} />
          <IconButton
            name="close"
            accessibilityLabel="Close job details"
            onPress={onClose}
            surface
            style={styles.closeButton}
          />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.companyRow}>
            <CompanyLogo logo={logoUrl ?? job.companyLogo} name={job.companyName} color={logoColor} size="lg" />
            <View style={styles.companyText}>
              <Text style={styles.company} numberOfLines={1}>
                {job.companyName}
              </Text>
              <Text style={styles.posted}>Posted {formatPostedAt(job.postedAt)}</Text>
            </View>
          </View>

          <Text style={styles.title}>{job.title}</Text>
          <JobMetadata job={job} emphasizeSalary />

          <Text style={styles.sectionTitle}>About the role</Text>
          <Text style={styles.body}>{job.description}</Text>

          <Text style={styles.sectionTitle}>What they look for</Text>
          {job.requirements.map((requirement) => (
            <View key={requirement} style={styles.bulletRow}>
              <Text style={styles.bullet}>{'\u2022'}</Text>
              <Text style={styles.body}>{requirement}</Text>
            </View>
          ))}

          <Text style={styles.sectionTitle}>Skills</Text>
          <View style={styles.skills}>
            {job.skills.map((skill) => (
              <SkillChip key={skill} label={skill} />
            ))}
          </View>

          <PrimaryButton label="Auto Apply" onPress={onApply} style={styles.applyButton} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  topBar: {
    height: 28,
    justifyContent: 'center',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  closeButton: {
    position: 'absolute',
    right: screenPadding,
    top: -6,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  companyText: {
    flex: 1,
  },
  company: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  posted: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.7,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
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
  applyButton: {
    marginTop: spacing.xl,
  },
}));
