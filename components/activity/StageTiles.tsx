import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';

import { STATUS_COLOR, STATUS_ICON, statusInk } from '@/components/activity/StatusChip';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { TrackedApplication } from '@/hooks/useApplications';
import type { ApplicationStatus } from '@/types';
import { hexToRgba } from '@/utils/color';
import { parseLocalDate, startOfWeek } from '@/utils/week';

/** In the order a season moves through them, which is also reading order in the grid. */
const STAGES: { status: ApplicationStatus; label: string }[] = [
  { status: 'applied', label: 'Applied' },
  { status: 'interview', label: 'Interviewing' },
  { status: 'offer', label: 'Offer' },
  { status: 'closed', label: 'Closed' },
];

interface StageTilesProps {
  applications: TrackedApplication[];
  /** The stage the list below is narrowed to, or null for all of them. */
  selected: ApplicationStatus | null;
  onSelect: (status: ApplicationStatus | null) => void;
}

/**
 * Where the season stands, as four tiles that are also the list's filter.
 *
 * Each carries its count and how many arrived there this week, which is the part a stage
 * total cannot say on its own: sixteen applied is a pile, "+3 this week" is momentum. Offer
 * is the one solid tile — it is the outcome worth celebrating — and names the company when
 * there is only one.
 *
 * Tapping the selected tile again clears the filter.
 */
export function StageTiles({ applications, selected, onSelect }: StageTilesProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const weekStart = startOfWeek(new Date()).getTime();

  return (
    <View style={styles.grid}>
      {STAGES.map(({ status, label }) => {
        const inStage = applications.filter((entry) => entry.application.status === status);
        const thisWeek = inStage.filter((entry) => movedAt(entry) >= weekStart).length;
        const isSelected = selected === status;
        const solid = status === 'offer' && inStage.length > 0;
        const tint = STATUS_COLOR[status];
        const ink = solid ? colors.textOnBrand : statusInk(status, colors.surface);
        const aside =
          solid && inStage.length === 1
            ? inStage[0]!.job.companyName
            : thisWeek > 0
              ? `+${thisWeek} wk`
              : null;

        return (
          <Pressable
            key={status}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(isSelected ? null : status);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${inStage.length} ${label}${thisWeek > 0 ? `, ${thisWeek} this week` : ''}. ${isSelected ? 'Showing only these. Tap to show all.' : 'Show only these.'}`}
            style={({ pressed }) => [
              styles.tile,
              solid ? { backgroundColor: tint } : null,
              isSelected ? { borderColor: tint, ...colors.shadowSoft, shadowColor: tint } : null,
              pressed ? styles.pressed : null,
            ]}>
            <View
              style={[
                styles.icon,
                { backgroundColor: solid ? 'rgba(255,255,255,0.24)' : hexToRgba(tint, colors.reelWashAlpha + 0.08) },
              ]}>
              <Ionicons name={STATUS_ICON[status]} size={15} color={solid ? colors.textOnBrand : tint} />
            </View>

            <Text style={[styles.count, solid ? { color: colors.textOnBrand } : null]}>{inStage.length}</Text>

            <View style={styles.footer}>
              <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
                {label}
              </Text>
              {aside ? (
                <Text style={[styles.aside, solid ? { color: colors.textOnBrand } : null]} numberOfLines={1}>
                  {aside}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** When the application reached its current stage: the submission for `applied`, else the last move. */
function movedAt(entry: TrackedApplication): number {
  const { status, appliedAt, updatedAt } = entry.application;
  // Both are read as local dates; `new Date()` would take a bare YYYY-MM-DD as UTC midnight.
  return parseLocalDate(status === 'applied' ? appliedAt : updatedAt)?.getTime() ?? 0;
}

const useStyles = makeStyles((colors) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm + 2,
  },
  tile: {
    // Two to a row, less half the gap each.
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.sm + 2,
    padding: spacing.lg,
    borderRadius: radius.xl - 4,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.85,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    fontSize: fontSize.hero,
    lineHeight: fontSize.hero + 2,
    fontWeight: '800',
    letterSpacing: -1,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  label: {
    flexShrink: 1,
    fontSize: fontSize.small,
    fontWeight: '700',
  },
  aside: {
    flexShrink: 1,
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));

