import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { hexToRgba } from '@/utils/color';
import type { ApplicationStatus } from '@/types';

/**
 * Stage colors. Only `offer` gets a saturated fill — it's the one outcome worth
 * celebrating, and if every stage were colored the list would read as an alert panel
 * rather than a record. `closed` stays deliberately grey: a rejection is information,
 * not a failure state to flag in red.
 */
const STATUS_COLOR: Record<ApplicationStatus, string> = {
  applied: '#5B8DEF',
  interview: '#F5A623',
  offer: '#22C55E',
  closed: '#8E8E9A',
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  interview: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
};

const STATUS_ICON: Record<ApplicationStatus, React.ComponentProps<typeof Ionicons>['name']> = {
  applied: 'paper-plane',
  interview: 'chatbubbles',
  offer: 'trophy',
  closed: 'remove-circle',
};

export { STATUS_COLOR, STATUS_LABEL, STATUS_ICON };

interface StatusChipProps {
  status: ApplicationStatus;
  /** Renders the label alongside the dot; off for tight rows that only need the color. */
  showLabel?: boolean;
}

export function StatusChip({ status, showLabel = true }: StatusChipProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const tint = STATUS_COLOR[status];

  return (
    <View style={[styles.chip, { backgroundColor: hexToRgba(tint, colors.reelWashAlpha + 0.06) }]}>
      <Ionicons name={STATUS_ICON[status]} size={11} color={tint} />
      {showLabel ? <Text style={[styles.label, { color: tint }]}>{STATUS_LABEL[status]}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm + 1,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
}));
