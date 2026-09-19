import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from '@/components/activity/StatusChip';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { hexToRgba } from '@/utils/color';
import type { ApplicationStatus } from '@/types';

const STAGES: ApplicationStatus[] = ['applied', 'interview', 'offer', 'closed'];

interface StatusPickerSheetProps {
  visible: boolean;
  current: ApplicationStatus | null;
  jobTitle: string;
  onSelect: (status: ApplicationStatus) => void;
  onClose: () => void;
}

/**
 * The full stage list, for moving an application anywhere — including backwards, which
 * the card's one-tap advance deliberately can't do.
 */
export function StatusPickerSheet({
  visible,
  current,
  jobTitle,
  onSelect,
  onClose,
}: StatusPickerSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close stage picker" />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(260)}
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.grabber} />

        <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
          {jobTitle}
        </Text>
        <Text style={styles.subtitle}>Where is this one at?</Text>

        <View style={styles.list}>
          {STAGES.map((stage) => {
            const selected = stage === current;
            const tint = STATUS_COLOR[stage];

            return (
              <Pressable
                key={stage}
                onPress={() => {
                  if (!selected) Haptics.selectionAsync();
                  onSelect(stage);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={STATUS_LABEL[stage]}
                style={({ pressed }) => [
                  styles.row,
                  selected ? { borderColor: tint, backgroundColor: hexToRgba(tint, 0.1) } : null,
                  pressed ? styles.pressed : null,
                ]}>
                <View style={[styles.dot, { backgroundColor: hexToRgba(tint, 0.16) }]}>
                  <Ionicons name={STATUS_ICON[stage]} size={15} color={tint} />
                </View>

                <Text style={styles.rowLabel}>{STATUS_LABEL[stage]}</Text>

                {selected ? <Ionicons name="checkmark" size={18} color={tint} /> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          CareerDeck can&apos;t see the employer&apos;s system, so stages are whatever you tell it.
        </Text>
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  list: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
  },
  pressed: {
    opacity: 0.75,
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  footnote: {
    marginTop: spacing.md,
    fontSize: fontSize.caption,
    lineHeight: 16,
    color: colors.textTertiary,
    textAlign: 'center',
  },
}));
