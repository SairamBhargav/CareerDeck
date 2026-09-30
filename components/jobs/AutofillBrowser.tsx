import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { draftPageQuestions } from '@/lib/api';
import {
  answerScript,
  applicationFormUrl,
  autofillScript,
  type AutofillAnswer,
  type AutofillMessage,
  type AutofillResume,
} from '@/lib/autofill';
import { reportError } from '@/lib/observability';

interface AutofillBrowserProps {
  /** The run whose resume and rules draft the page's leftover questions. */
  runId: string;
  applyUrl: string;
  answers: AutofillAnswer[];
  resume: AutofillResume | null;
  companyName: string;
  /** The page showed a "thanks for applying" confirmation. */
  onSubmitted: () => void;
  onClose: () => void;
}

/**
 * The employer's application, open inside the app with the reviewed answers filled in.
 *
 * Rendered as a full-screen layer inside AutoApplySheet's own Modal rather than as a second
 * Modal, because stacked Modals misbehave on Android. The reader checks the page and presses the
 * employer's own Submit; the bar at the bottom says how much was filled and what is left.
 */
export function AutofillBrowser({
  runId,
  applyUrl,
  answers,
  resume,
  companyName,
  onSubmitted,
  onClose,
}: AutofillBrowserProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const webView = useRef<WebView>(null);
  const [progress, setProgress] = useState<{ filled: number; total: number; resumeAttached: boolean; aiFilled: number } | null>(null);
  /** Questions currently with the drafter. */
  const [drafting, setDrafting] = useState(0);
  const [loading, setLoading] = useState(true);
  const submitted = useRef(false);

  const url = useMemo(() => applicationFormUrl(applyUrl), [applyUrl]);
  const script = useMemo(() => autofillScript(answers, resume), [answers, resume]);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: AutofillMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as AutofillMessage;
    } catch {
      return;
    }
    if (message.type === 'progress') {
      setProgress((current) => {
        if (message.filled > (current?.filled ?? 0)) Haptics.selectionAsync();
        return {
          filled: message.filled,
          total: message.total,
          resumeAttached: message.resumeAttached,
          aiFilled: message.aiFilled,
        };
      });
    } else if (message.type === 'questions') {
      const count = message.questions.length;
      setDrafting((n) => n + count);
      draftPageQuestions(runId, message.questions)
        .then((answers) => {
          if (answers.length > 0) webView.current?.injectJavaScript(answerScript(answers));
        })
        .catch((error) => reportError(error, { where: 'AutofillBrowser.questions' }))
        .finally(() => setDrafting((n) => Math.max(0, n - count)));
    } else if (message.type === 'submitted' && !submitted.current) {
      submitted.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSubmitted();
    }
  };

  const filled = (progress?.filled ?? 0) + (progress?.aiFilled ?? 0);
  const status = !progress
    ? 'Looking for the application form…'
    : drafting > 0
      ? `Filled ${filled}. Writing answers to ${drafting} more question${drafting === 1 ? '' : 's'} from your resume…`
      : filled === 0
        ? 'No form fields yet — tap Apply on the page if there is one.'
        : `Filled ${filled} answer${filled === 1 ? '' : 's'}${progress.resumeAttached ? ' and attached your resume' : ''}. ` +
          (progress.aiFilled > 0
            ? `Green is from your profile; amber was written by AI — read those. Then Submit.`
            : 'Check the page, finish anything left, then Submit.');

  return (
    <View style={[styles.layer, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close the application">
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Apply to {companyName}
          </Text>
          <Text style={styles.headerHost} numberOfLines={1}>
            {safeHost(url)}
          </Text>
        </View>
        <Pressable
          onPress={() => webView.current?.injectJavaScript(script)}
          hitSlop={10}
          accessibilityLabel="Fill the form again">
          <Ionicons name="flash" size={20} color={colors.autoApply} />
        </Pressable>
        <Pressable
          onPress={() => Linking.openURL(url).catch(() => undefined)}
          hitSlop={10}
          accessibilityLabel="Open in your browser">
          <Ionicons name="open-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      <WebView
        ref={webView}
        source={{ uri: url }}
        style={styles.web}
        injectedJavaScript={script}
        onMessage={onMessage}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => {
          setLoading(false);
          // Every page of a multi-step form gets the script again; it is idempotent.
          webView.current?.injectJavaScript(script);
        }}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
      />
      {loading ? <ActivityIndicator style={styles.spinner} /> : null}

      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.barRow}>
          <Ionicons name="flash" size={14} color={colors.autoApply} />
          <Text style={styles.barText}>{status}</Text>
        </View>
        <PrimaryButton label="I submitted it" variant="secondary" onPress={onSubmitted} />
      </View>
    </View>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const useStyles = makeStyles((colors) => ({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  headerHost: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  web: {
    flex: 1,
    backgroundColor: colors.background,
  },
  spinner: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
  },
  bar: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  barText: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textSecondary,
  },
}));
