import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { STATUS_LABEL, StatusChip } from '@/components/activity/StatusChip';
import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { TrackedApplication } from '@/hooks/useApplications';
import type { ApplicationStatus } from '@/types';
import { formatPostedAt } from '@/utils/format';

/** Where the application actually went, shown plainly — see ApplicationSource. */
const SOURCE_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  workday: 'Workday',
  lever: 'Lever',
  ashby: 'Ashby',
  company: 'Company site',
};

/**
 * The one-tap forward move for each stage. Only forward: going backwards is rare enough
 * that it belongs behind the full picker rather than a button you can hit by accident.
 */
const NEXT_STAGE: Partial<Record<ApplicationStatus, ApplicationStatus>> = {
  applied: 'interview',
  interview: 'offer',
};

interface ApplicationCardProps {
  entry: TrackedApplication;
  onPress: () => void;
  onAdvance: (status: ApplicationStatus) => void;
  onOpenStatusPicker: () => void;
}

/**
 * One tracked application. The stage chip is the point of the card — everything else is
 * there to identify which application it belongs to — so it sits on its own line with
 * the one-tap advance beside it rather than being buried in the metadata row.
 */
export function ApplicationCard({ entry, onPress, onAdvance, onOpenStatusPicker }: ApplicationCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { application, job, company } = entry;

  const next = NEXT_STAGE[application.status];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.companyName}, ${STATUS_LABEL[application.status]}`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.head}>
        <CompanyLogo
          logo={company?.logo ?? job.companyLogo}
          name={job.companyName}
          color={company?.logoColor}
          size="sm"
        />

        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>
            {job.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {job.companyName} · {SOURCE_LABEL[application.source] ?? application.source}
          </Text>
        </View>

        <Pressable
          onPress={onOpenStatusPicker}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Change stage for ${job.title}`}
          style={({ pressed }) => [styles.more, pressed ? styles.pressed : null]}>
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Animated.View key={application.status} entering={FadeIn.duration(200)}>
          <StatusChip status={application.status} />
        </Animated.View>

        <Text style={styles.date}>Applied {formatPostedAt(application.appliedAt)}</Text>

        <View style={styles.spacer} />

        {next ? (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onAdvance(next);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Move ${job.title} to ${STATUS_LABEL[next]}`}
            style={({ pressed }) => [styles.advance, pressed ? styles.pressed : null]}>
            <Text style={styles.advanceLabel}>{STATUS_LABEL[next]}</Text>
            <Ionicons name="arrow-forward" size={12} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.75,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  more: {
    padding: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  date: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  spacer: {
    flex: 1,
  },
  advance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  advanceLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
}));
