import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { ReportReason } from '@/types';

/**
 * The report path — README §10: *"a report path that reaches a human within 24h"*.
 *
 * Two things this sheet is built around.
 *
 * **Reporting and blocking travel together.** They are separate actions with separate meanings — a
 * report goes to a moderator and takes a day, a block is immediate and personal — but somebody
 * reporting harassment almost always wants both, and making them find a second menu to stop seeing
 * the person is a bad half-minute at the worst possible time. So blocking is a checkbox here, on by
 * default for the reasons where it obviously applies.
 *
 * **It names who the report reaches.** "Reported" with no further information reads like a form
 * going into a void, and the void is what stops people using it a second time. §10 commits to a
 * human within 24 hours; saying so is what makes the commitment worth having made.
 *
 * Note that the caller passes a *comment* id and never an author id — the client does not have one.
 * §3.8: the author is resolved server-side, so a reporter cannot learn who they reported.
 */

interface ReportSheetProps {
  visible: boolean;
  /** The pseudonym, so the sheet can say who is being blocked without naming a person. */
  authorHandle: string;
  busy?: boolean;
  onSubmit: (reason: ReportReason, detail: string | undefined, blockToo: boolean) => void;
  onClose: () => void;
}

interface ReasonOption {
  reason: ReportReason;
  label: string;
  hint: string;
  /**
   * Whether "also block them" starts checked. On for everything aimed at the reader personally;
   * off for spam and false information, which are about the comment and not about being targeted.
   */
  blockByDefault: boolean;
}

const REASONS: ReasonOption[] = [
  {
    reason: 'harassment',
    label: 'Harassment or abuse',
    hint: 'Aimed at me or at someone else',
    blockByDefault: true,
  },
  {
    reason: 'threat',
    label: 'Threats or violence',
    hint: 'Including telling someone to harm themselves',
    blockByDefault: true,
  },
  { reason: 'sexual', label: 'Sexual content', hint: 'Explicit or unwanted', blockByDefault: true },
  {
    reason: 'doxxing',
    label: 'Personal information',
    hint: 'Contact details, an address, or identifying someone',
    blockByDefault: true,
  },
  {
    reason: 'spam',
    label: 'Spam or self-promotion',
    hint: 'Selling, recruiting, or referral farming',
    blockByDefault: false,
  },
  {
    reason: 'false information',
    label: 'Made-up claim about a company',
    hint: 'Not "I disagree" — something stated as fact that did not happen',
    blockByDefault: false,
  },
  {
    reason: 'something else',
    label: 'Something else',
    hint: 'Tell us below',
    blockByDefault: false,
  },
];

export function ReportSheet({ visible, authorHandle, busy = false, onSubmit, onClose }: ReportSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const [selected, setSelected] = useState<ReasonOption | null>(null);
  const [detail, setDetail] = useState('');
  const [blockToo, setBlockToo] = useState(false);

  const choose = (option: ReasonOption) => {
    setSelected(option);
    setBlockToo(option.blockByDefault);
  };

  const submit = () => {
    if (!selected) return;
    onSubmit(selected.reason, detail.trim().length > 0 ? detail.trim() : undefined, blockToo);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabberZone}>
          <View style={styles.grabber} />
        </View>

        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Report this comment
          </Text>
          <Text style={styles.subtitle}>
            A person reads every report, usually within a day. Threats are looked at within an hour.
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {REASONS.map((option) => {
            const active = selected?.reason === option.reason;
            return (
              <Pressable
                key={option.reason}
                onPress={() => choose(option)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={`${option.label}. ${option.hint}`}
                style={({ pressed }) => [
                  styles.option,
                  active ? styles.optionActive : null,
                  pressed ? styles.pressed : null,
                ]}>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionHint}>{option.hint}</Text>
                </View>
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? colors.text : colors.textTertiary}
                />
              </Pressable>
            );
          })}

          {selected ? (
            <>
              <TextInput
                value={detail}
                onChangeText={setDetail}
                placeholder="Anything a moderator should know (optional)"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                multiline
                maxLength={500}
                accessibilityLabel="Extra detail for the moderator"
              />

              <Pressable
                onPress={() => setBlockToo((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: blockToo }}
                accessibilityLabel={`Also block ${authorHandle}`}
                style={({ pressed }) => [styles.checkRow, pressed ? styles.pressed : null]}>
                <Ionicons
                  name={blockToo ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={blockToo ? colors.text : colors.textTertiary}
                />
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>Also block {authorHandle}</Text>
                  {/* Says what a block does, because "block" means different things on different
                      apps and here it is symmetrical — neither of you sees the other again. */}
                  <Text style={styles.optionHint}>
                    You stop seeing their comments and they stop seeing yours, straight away.
                  </Text>
                </View>
              </Pressable>
            </>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <PrimaryButton
            label={busy ? 'Sending…' : 'Send report'}
            onPress={submit}
            disabled={selected === null || busy}
          />
        </View>
      </View>
    </Modal>
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
    maxHeight: '88%',
  },
  grabberZone: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  header: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.md,
    gap: 4,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textTertiary,
  },
  list: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: minTapTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  optionActive: {
    borderColor: colors.text,
    backgroundColor: colors.backgroundMuted,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  optionHint: {
    fontSize: fontSize.caption,
    lineHeight: 16,
    color: colors.textTertiary,
  },
  input: {
    minHeight: 72,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.small,
    lineHeight: 19,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  actions: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
}));
