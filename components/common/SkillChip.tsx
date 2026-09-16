import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/constants/theme';

interface SkillChipProps {
  label: string;
  /** Chips on the Reels screen sit on a dark background. */
  onDark?: boolean;
}

export function SkillChip({ label, onDark = false }: SkillChipProps) {
  return (
    <View style={[styles.chip, onDark ? styles.chipDark : styles.chipLight]}>
      <Text style={[styles.label, onDark ? styles.labelDark : styles.labelLight]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLight: {
    backgroundColor: colors.backgroundMuted,
    borderColor: colors.border,
  },
  chipDark: {
    backgroundColor: colors.reelSurface,
    borderColor: colors.reelBorder,
  },
  label: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
  },
  labelLight: { color: colors.textSecondary },
  labelDark: { color: colors.reelTextSecondary },
});
