import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import {
  CONTENT_POLICY_FOOTER,
  CONTENT_POLICY_INTRO,
  CONTENT_POLICY_POINTS,
  CONTENT_POLICY_TITLE,
} from '@/constants/policy';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface CommentPolicySheetProps {
  visible: boolean;
  /** True while the acceptance is being written, so the button cannot be double-tapped. */
  busy?: boolean;
  onAccept: () => void;
  onClose: () => void;
}

/**
 * The content policy, shown once — README §10: *"a clear content policy shown at first comment"*.
 *
 * §10 lists this first among the mitigations for the risk the product actually carries: *"A verified
 * student anonymously claiming a named company did something illegal is your highest-severity
 * failure mode."* A policy nobody read is not a mitigation, which is why this is four points and not
 * a page, and why it appears at the moment it is relevant rather than buried in Settings.
 *
 * It is shown **before** the composer opens rather than after a comment is refused. Somebody who
 * has already typed four hundred characters and pressed send is not in a mood to read anything, and
 * the one thing this has to communicate — criticising a company is fine, going after a person is
 * not — is the distinction they most need *before* they write.
 *
 * Accepting writes the version to `profiles`, so what exists afterwards is not "users agree to a
 * policy" but "this account was shown v2026-09-24 on this date". That record is the thing a
 * notice-and-takedown response needs.
 */
export function CommentPolicySheet({ visible, busy = false, onAccept, onClose }: CommentPolicySheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabberZone}>
          <View style={styles.grabber} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title} accessibilityRole="header">
            {CONTENT_POLICY_TITLE}
          </Text>
          <Text style={styles.intro}>{CONTENT_POLICY_INTRO}</Text>

          {CONTENT_POLICY_POINTS.map((point) => (
            <View key={point.title} style={styles.point}>
              <View style={styles.pointIcon}>
                <Ionicons name={point.icon} size={18} color={colors.text} />
              </View>
              <View style={styles.pointText}>
                <Text style={styles.pointTitle}>{point.title}</Text>
                <Text style={styles.pointBody}>{point.body}</Text>
              </View>
            </View>
          ))}

          <Text style={styles.footer}>{CONTENT_POLICY_FOOTER}</Text>
        </ScrollView>

        <View style={styles.actions}>
          <PrimaryButton
            label={busy ? 'Saving…' : 'I understand'}
            onPress={onAccept}
            disabled={busy}
          />
          {/* A way out that is not "agree". Somebody should be able to read this and decide not to
              comment, and a sheet with one button does not let them. */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}>
            <Text style={styles.secondaryLabel}>Not now</Text>
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
    maxHeight: '86%',
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
  content: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
  },
  intro: {
    fontSize: fontSize.small,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  point: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  pointIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
  },
  pointText: {
    flex: 1,
    gap: 3,
  },
  pointTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  pointBody: {
    fontSize: fontSize.small,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  footer: {
    fontSize: fontSize.caption,
    lineHeight: 18,
    color: colors.textTertiary,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actions: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  secondaryLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
