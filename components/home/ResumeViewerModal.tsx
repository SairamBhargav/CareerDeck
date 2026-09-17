import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SkillChip } from '@/components/common/SkillChip';
import { colors, fontSize, radius, screenPadding, shadow, spacing } from '@/constants/theme';
import type { Resume } from '@/types';
import { formatPostedAt } from '@/utils/format';

interface ResumeViewerModalProps {
  resume: Resume | null;
  userName: string;
  isDefault: boolean;
  visible: boolean;
  onClose: () => void;
  onSetDefault: () => void;
}

/**
 * Opens a resume bubble into a full document view, Google Docs–style: a white "page"
 * floating on a neutral canvas, with the file's own name/last-edited date and a Set as
 * Default action pinned above it rather than scrolled away with the content.
 */
export function ResumeViewerModal({
  resume,
  userName,
  isDefault,
  visible,
  onClose,
  onSetDefault,
}: ResumeViewerModalProps) {
  const insets = useSafeAreaInsets();

  if (!resume) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close resume" />

      <View style={[styles.sheet, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.topBar}>
          <View style={styles.grabber} />
          <IconButton
            name="close"
            accessibilityLabel="Close resume"
            onPress={onClose}
            surface
            style={styles.closeButton}
          />
        </View>

        <View style={styles.fileBar}>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {resume.name}
            </Text>
            <Text style={styles.fileMeta}>Edited {formatPostedAt(resume.updatedAt).toLowerCase()}</Text>
          </View>

          <PrimaryButton
            label={isDefault ? 'Default' : 'Set as Default'}
            variant={isDefault ? 'secondary' : 'primary'}
            disabled={isDefault}
            onPress={onSetDefault}
            style={styles.defaultButton}
          />
        </View>

        <ScrollView
          style={styles.canvas}
          contentContainerStyle={[styles.canvasContent, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.page}>
            <Text style={styles.pageName}>{userName}</Text>
            <Text style={styles.contactLine}>{resume.contactLine}</Text>

            <Text style={styles.summary}>{resume.summary}</Text>

            <Text style={styles.sectionHeading}>Education</Text>
            {resume.education.map((entry) => (
              <View key={entry.school} style={styles.entry}>
                <View style={styles.entryHeaderRow}>
                  <Text style={styles.entryTitle}>{entry.school}</Text>
                  <Text style={styles.entryPeriod}>{entry.period}</Text>
                </View>
                <Text style={styles.entrySubtitle}>{entry.degree}</Text>
                {entry.detail ? <Text style={styles.entryDetail}>{entry.detail}</Text> : null}
              </View>
            ))}

            <Text style={styles.sectionHeading}>Experience</Text>
            {resume.experience.map((entry) => (
              <View key={`${entry.role}-${entry.organization}`} style={styles.entry}>
                <View style={styles.entryHeaderRow}>
                  <Text style={styles.entryTitle}>{entry.role}</Text>
                  <Text style={styles.entryPeriod}>{entry.period}</Text>
                </View>
                <Text style={styles.entrySubtitle}>{entry.organization}</Text>
                {entry.bullets.map((bullet) => (
                  <View key={bullet} style={styles.bulletRow}>
                    <Text style={styles.bullet}>{'•'}</Text>
                    <Text style={styles.bulletText}>{bullet}</Text>
                  </View>
                ))}
              </View>
            ))}

            <Text style={styles.sectionHeading}>Skills</Text>
            <View style={styles.skills}>
              {resume.skills.map((skill) => (
                <SkillChip key={skill} label={skill} />
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  topBar: {
    height: 28,
    justifyContent: 'center',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  closeButton: {
    position: 'absolute',
    right: screenPadding,
    top: -6,
  },
  fileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
  },
  fileMeta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 1,
  },
  defaultButton: {
    paddingHorizontal: spacing.lg,
    minHeight: 38,
  },
  // The gray canvas the "page" floats on — the part that reads as Google Docs.
  canvas: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
  },
  canvasContent: {
    padding: screenPadding,
  },
  page: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
    ...shadow.soft,
  },
  pageName: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
  },
  contactLine: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
  },
  summary: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  sectionHeading: {
    fontSize: fontSize.small,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.text,
    marginTop: spacing.lg,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  entry: {
    marginTop: spacing.sm,
    gap: 2,
  },
  entryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  entryTitle: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  entryPeriod: {
    fontSize: fontSize.caption + 1,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  entrySubtitle: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  entryDetail: {
    fontSize: fontSize.caption + 1,
    color: colors.textTertiary,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 2,
  },
  bullet: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    lineHeight: 19,
  },
  bulletText: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  skills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
