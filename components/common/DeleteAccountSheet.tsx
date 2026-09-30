import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/**
 * The confirmation for deleting an account, which now happens immediately.
 *
 * ── Why this is a sheet and not an Alert ──────────────────────────────────────
 *
 * The native alert was fine when deletion was reversible for thirty days: a sentence and
 * two buttons is proportionate to a decision you can walk back. It is not proportionate
 * to an irreversible one. An alert gives you a paragraph nobody reads and a red button
 * next to the cancel, and the two are the same size.
 *
 * This sheet says specifically what goes and what stays, and puts a deliberate gap
 * between "Delete" and "Cancel" so the destructive option is not the one your thumb is
 * already resting on.
 *
 * ── Why the list is concrete ──────────────────────────────────────────────────
 *
 * "This cannot be undone" is true and tells somebody nothing. A student deciding this
 * wants to know whether their applications go, whether the comments they wrote stay up,
 * and whether they can come back on the same email. Those are the three things named,
 * because those are the three things actually asked.
 */

interface DeleteAccountSheetProps {
  visible: boolean;
  /** True while the purge is running, so nothing can be tapped twice. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** What disappears, what survives, and what it means for coming back. */
const CONSEQUENCES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'trash-outline',
    title: 'Everything goes, now',
    body: 'Your profile, resumes, saved roles, follows and application history. There is no undo and no grace period.',
  },
  {
    icon: 'chatbubble-outline',
    title: 'Your comments stay up',
    body: 'They stop being attached to you — your name and badge come off — so nobody is left replying to a gap.',
  },
  {
    icon: 'mail-outline',
    title: 'Your email is free again',
    body: 'You can sign up with the same address straight away, and start over from the beginning.',
  },
];

export function DeleteAccountSheet({ visible, busy = false, onConfirm, onClose }: DeleteAccountSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={busy ? undefined : onClose}
        accessibilityLabel="Close"
      />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabberZone}>
          <View style={styles.grabber} />
        </View>

        <View style={styles.content}>
          <View style={styles.mark}>
            <Ionicons name="warning-outline" size={22} color={colors.danger} />
          </View>

          <Text style={styles.title} accessibilityRole="header">
            Delete your account?
          </Text>
          <Text style={styles.intro}>This happens the moment you tap Delete.</Text>

          {CONSEQUENCES.map((item) => (
            <View key={item.title} style={styles.point}>
              <View style={styles.pointIcon}>
                <Ionicons name={item.icon} size={17} color={colors.textSecondary} />
              </View>
              <View style={styles.pointText}>
                <Text style={styles.pointTitle}>{item.title}</Text>
                <Text style={styles.pointBody}>{item.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          {/*
            * Cancel first and full width; Delete underneath and quieter. The reverse is
            * the usual shape and the wrong one here — the safe choice should be the one
            * already under a thumb, and the irreversible one should take a moment to
            * reach.
            */}
          <Pressable
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Keep my account"
            style={({ pressed }) => [styles.keep, pressed ? styles.pressed : null]}>
            <Text style={styles.keepLabel}>Keep my account</Text>
          </Pressable>

          <Pressable
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Delete my account permanently"
            style={({ pressed }) => [styles.delete, pressed ? styles.pressed : null]}>
            <Text style={styles.deleteLabel}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </Text>
          </Pressable>
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
  },
  grabberZone: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  content: {
    paddingHorizontal: screenPadding + spacing.xs,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text,
  },
  intro: {
    marginTop: -spacing.xs,
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  point: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  pointIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  pointText: {
    flex: 1,
    gap: 2,
  },
  pointTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  pointBody: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textTertiary,
  },
  actions: {
    paddingHorizontal: screenPadding + spacing.xs,
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  keep: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.text,
  },
  keepLabel: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.background,
  },
  delete: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deleteLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.danger,
  },
  pressed: {
    opacity: 0.75,
  },
}));
