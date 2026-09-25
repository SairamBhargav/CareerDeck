import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
  /** Asks the API service for a signed URL. Every call writes a `pii_access_log` row. */
  onRequestUrl: (resumeId: string) => Promise<string>;
}

/**
 * Opens a resume bubble into the actual PDF, rendered full-height in a WebView — a file
 * bar with the resume's name/last-edited date and a Set as Default action sit above it,
 * pinned so they don't scroll away with the document.
 *
 * ── The URL is fetched, not resolved ──────────────────────────────────────────
 *
 * Through phase 3 the two resumes were bundled assets and `Asset.fromModule().uri` answered
 * synchronously. A stored resume lives in a private bucket that grants `select` to nobody —
 * not even its owner — so opening one is a round trip to `GET /v1/resumes/:id/url`, which
 * writes an audit row and then signs a URL good for five minutes.
 *
 * That is §3.9's "every signed URL issued … writes a row" showing up in the UI as a spinner.
 * It is a real cost and it is the point: the alternative is an owner-readable bucket and an
 * audit log with a hole in it exactly where the app's own reads should be. PHASE4.md §4.2.
 */
export function ResumeViewerModal({
  resume,
  isDefault,
  visible,
  onClose,
  onSetDefault,
  onRequestUrl,
}: ResumeViewerModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();

  const resumeId = resume?.id ?? null;

  /*
   * A query rather than an effect, because that is what this is — a fetch keyed on which
   * resume is open, with a lifetime.
   *
   * `staleTime` and `gcTime` are both four minutes against a URL the service signs for five.
   * Reopening the same resume inside that window reuses the URL and writes no second audit
   * row, which is correct: it is one person looking at one document. Past it the entry is
   * gone and the next open signs again, rather than handing the WebView a URL that expired
   * while the app was backgrounded.
   */
  const urlQuery = useQuery({
    queryKey: ['resume', 'url', resumeId],
    queryFn: () => onRequestUrl(resumeId as string),
    enabled: visible && resumeId !== null,
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
    // A failed signing is shown, not retried behind the user's back — each attempt is another
    // row in the access log.
    retry: false,
  });

  const pdfUri = urlQuery.data ?? null;
  const error = urlQuery.error
    ? urlQuery.error instanceof Error
      ? urlQuery.error.message
      : 'That file could not be opened right now.'
    : null;

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
          {error !== null ? (
            <View style={styles.pdfState}>
              <Text style={styles.pdfError}>{error}</Text>
            </View>
          ) : pdfUri ? (
            <WebView
              source={{ uri: pdfUri }}
              style={styles.pdf}
              originWhitelist={['*']}
              // The document itself is a white page in both schemes; this only stops a
              // white flash against a dark sheet while it loads.
              backgroundColor={colors.backgroundMuted}
            />
          ) : (
            <View style={styles.pdfState}>
              <ActivityIndicator color={colors.textTertiary} />
            </View>
          )}
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
  pdfState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: screenPadding,
  },
  pdfError: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
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
