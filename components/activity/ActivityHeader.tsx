import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { STATUS_COLOR, STATUS_ICON } from '@/components/activity/StatusChip';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { PipelineCounts } from '@/hooks/useApplications';
import { hexToRgba } from '@/utils/color';
import type { ApplicationStatus } from '@/types';

/** Left to right in the order a season moves through them. */
const STAGES: { status: ApplicationStatus; one: string; many: string }[] = [
  { status: 'applied', one: 'Applied', many: 'Applied' },
  { status: 'interview', one: 'Interviewing', many: 'Interviewing' },
  { status: 'offer', one: 'Offer', many: 'Offers' },
  { status: 'closed', one: 'Closed', many: 'Closed' },
];

interface ActivityHeaderProps {
  counts: PipelineCounts;
}

/**
 * The top of Activity: the title, and where the season stands.
 *
 * This replaced a grey "N in play · N closed out" line (2026-10-07). The pills use each stage's
 * color and icon from StatusChip, so the header reads as a key to the application cards below.
 * A stage at zero is left out, so the row lists only what is actually happening.
 */
export function ActivityHeader({ counts }: ActivityHeaderProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const stages = STAGES.filter(({ status }) => counts[status] > 0);

  return (
    <View style={styles.heading}>
      <Text style={styles.title} accessibilityRole="header">
        Activity
      </Text>

      {stages.length > 0 ? (
        <View style={styles.pills}>
          {stages.map(({ status, one, many }) => {
            const tint = STATUS_COLOR[status];
            const n = counts[status];
            return (
              <View
                key={status}
                accessible
                accessibilityLabel={`${n} ${n === 1 ? one : many}`}
                style={[
                  styles.pill,
                  {
                    backgroundColor: hexToRgba(tint, colors.reelWashAlpha + 0.06),
                    borderColor: hexToRgba(tint, 0.22),
                  },
                ]}>
                <Ionicons name={STATUS_ICON[status]} size={12} color={tint} />
                <Text style={[styles.count, { color: tint }]}>{n}</Text>
                <Text style={styles.label}>{n === 1 ? one : many}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.empty}>Apply from the Deck and your season shows up here.</Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  heading: {
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  // Home's greeting, so the two tabs open at the same size and weight.
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.7,
    lineHeight: 36,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: {
    fontSize: fontSize.small,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  empty: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
}));
