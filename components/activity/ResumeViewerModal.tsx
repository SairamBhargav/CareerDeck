import { Asset } from 'expo-asset';
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Resume } from '@/types';
import { formatPostedAt } from '@/utils/format';

interface ResumeViewerModalProps {
  resume: Resume | null;
  isDefault: boolean;
  visible: boolean;
  onClose: () => void;
  onSetDefault: () => void;
}

/**
 * Opens a resume bubble into the actual PDF, rendered full-height in a WebView — a file
 * bar with the resume's name/last-edited date and a Set as Default action sit above it,
 * pinned so they don't scroll away with the document.
 */
export function ResumeViewerModal({ resume, isDefault, visible, onClose, onSetDefault }: ResumeViewerModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();

  // Local bundled assets resolve their .uri synchronously — no download step needed,
  // unlike a remote asset fetched over the network.
  const pdfUri = useMemo(() => (resume ? Asset.fromModule(resume.pdf).uri : null), [resume]);

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

        <View style={[styles.pdfWrap, { paddingBottom: insets.bottom }]}>
          {pdfUri ? (
            <WebView
              source={{ uri: pdfUri }}
              style={styles.pdf}
              originWhitelist={['*']}
              // The document itself is a white page in both schemes; this only stops a
              // white flash against a dark sheet while it loads.
              backgroundColor={colors.backgroundMuted}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
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
  pdfWrap: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
  },
  pdf: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
  },
}));
