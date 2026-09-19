import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AnimatedCount } from '@/components/common/AnimatedCount';
import { STATUS_COLOR } from '@/components/activity/StatusChip';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { PipelineCounts } from '@/hooks/useApplications';
import type { ApplicationStatus } from '@/types';

const STAGES: { key: ApplicationStatus; label: string }[] = [
  { key: 'applied', label: 'Applied' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'closed', label: 'Closed' },
];

/** Per-column stagger, so the four tiles land left to right rather than all at once. */
const STAGGER_MS = 60;

interface PipelineStripProps {
  counts: PipelineCounts;
}

/**
 * The state of the whole season in one row. Four tiles rather than the old inline
 * figures: these are a readout, not a filter, and making them look tappable was half of
 * why the previous version was confusing — "Applied" was a number you could not click
 * sitting next to three that you could.
 */
export function PipelineStrip({ counts }: PipelineStripProps) {
  const styles = useStyles();

  return (
    <View style={styles.row}>
      {STAGES.map((stage, index) => (
        <Animated.View
          key={stage.key}
          entering={FadeInDown.duration(280).delay(index * STAGGER_MS)}
          style={styles.tile}>
          <View style={[styles.bar, { backgroundColor: STATUS_COLOR[stage.key] }]} />
          <AnimatedCount value={counts[stage.key]} style={styles.value} />
          <Text style={styles.label} numberOfLines={1}>
            {stage.label}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // A short colored rule rather than a full tinted tile — enough to tie the number to
  // its stage chip in the list below without four colored blocks fighting each other.
  bar: {
    width: 18,
    height: 3,
    borderRadius: 2,
    marginBottom: spacing.xs,
  },
  value: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
  },
  label: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontWeight: '600',
  },
}));
