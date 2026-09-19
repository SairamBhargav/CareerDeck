import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import type { ApplicationSource, Job } from '@/types';

/**
 * Which applicant tracking system a posting's URL points at. CareerDeck can't submit
 * on the user's behalf to any of them — Greenhouse and Lever gate submission behind
 * per-employer API keys, and every Workday customer is a separate tenant with its own
 * account system — so the only honest flow is: hand off, then ask.
 */
function sourceFromUrl(url: string): ApplicationSource {
  const target = url.toLowerCase();
  if (target.includes('greenhouse')) return 'greenhouse';
  if (target.includes('workday') || target.includes('myworkdayjobs')) return 'workday';
  if (target.includes('lever')) return 'lever';
  if (target.includes('ashby')) return 'ashby';
  return 'company';
}

const SOURCE_LABEL: Record<ApplicationSource, string> = {
  greenhouse: 'Greenhouse',
  workday: 'Workday',
  lever: 'Lever',
  ashby: 'Ashby',
  company: "the company's site",
};

interface ApplicationModalProps {
  job: Job | null;
  /** Name of the resume currently set as default on Home. */
  resumeName: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * Bottom sheet shown when a reel's Apply action is pressed.
 *
 * Two steps, because there is no third option: send the user to the employer's ATS,
 * then ask whether they finished. Nothing here can observe a real submission, so the
 * sheet asks instead of guessing, and what the user says is what Activity tracks.
 */
export function ApplicationModal({ job, resumeName, visible, onClose }: ApplicationModalProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { logApplication, hasApplied } = useCareerDeck();
  const [handedOff, setHandedOff] = useState(false);

  // Reset the step whenever a different job opens the sheet.
  useEffect(() => {
    if (!visible) setHandedOff(false);
  }, [visible]);

  if (!job) return null;

  const source = sourceFromUrl(job.applicationUrl);
  const alreadyTracked = hasApplied(job.id);

  const handleOpen = () => {
    setHandedOff(true);
    Linking.openURL(job.applicationUrl).catch(() => {
      // A dead link shouldn't strand the sheet mid-flow — the confirm step still
      // stands, since the user may well have applied another way.
    });
  };

  const handleConfirm = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logApplication(job.id, source);
    onClose();
  };

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

        <Text style={styles.notice}>
          {alreadyTracked
            ? "This one's already in your Activity tracker."
            : `${job.companyName} takes applications on ${SOURCE_LABEL[source]}. We'll send you over, then you can mark it here.`}
        </Text>

        <View style={styles.actions}>
          {handedOff ? (
            <PrimaryButton
              label="I applied — track it"
              onPress={handleConfirm}
              accessibilityHint="Adds this job to your Activity tracker as applied."
            />
          ) : (
            <PrimaryButton
              label={`Continue to ${SOURCE_LABEL[source]}`}
              onPress={handleOpen}
              accessibilityHint="Opens the employer's application page in your browser."
            />
          )}
          <PrimaryButton label={handedOff ? 'Not yet' : 'Cancel'} variant="ghost" onPress={onClose} />
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
    lineHeight: 19,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing.sm,
  },
}));
