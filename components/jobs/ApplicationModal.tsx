import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Job } from '@/types';

interface ApplicationModalProps {
  job: Job | null;
  /** Name of the resume currently set as default on Home. */
  resumeName: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet shown when a reel's Apply action is pressed.
 * Nothing is submitted - this is the entry point for the future AI-assisted review flow.
 */
export function ApplicationModal({ job, resumeName, visible, onClose }: ApplicationModalProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [reviewRequested, setReviewRequested] = useState(false);

  // Reset the confirmation message whenever a different job opens the sheet.
  useEffect(() => {
    if (!visible) setReviewRequested(false);
  }, [visible]);

  if (!job) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close application sheet" />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.grabber} />

        <Text style={styles.title} accessibilityRole="header">
          Apply to {job.title}
        </Text>

        <View style={styles.details}>
          <DetailRow label="Company" value={job.companyName} />
          <DetailRow label="Role" value={`${job.title} · ${job.employmentType}`} />
          <DetailRow label="Location" value={`${job.location} · ${job.locationType}`} />
          <DetailRow label="Resume" value={resumeName} />
        </View>

        {reviewRequested ? (
          <Text style={styles.notice} accessibilityLiveRegion="polite">
            Application review flow coming soon.
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label="Review Application"
            onPress={() => setReviewRequested(true)}
            accessibilityHint="Opens the application review step. Nothing is submitted yet."
          />
          <PrimaryButton label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();

  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  details: {
    backgroundColor: colors.backgroundMuted,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  detailLabel: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  detailValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: fontSize.small,
    color: colors.text,
    fontWeight: '600',
  },
  notice: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
  },
}));
