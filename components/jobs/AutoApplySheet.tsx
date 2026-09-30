import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { AutofillBrowser } from '@/components/jobs/AutofillBrowser';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { applicationsKey } from '@/hooks/useApplicationRecords';
import {
  abandonAutoApply,
  completeAutoApply,
  fetchAutoApplyRun,
  fetchResumeUrl,
  reviewAutoApply,
  startAutoApply,
  type AutoApplyRun,
  type DraftField,
} from '@/lib/api';
import { useApplicationAnswers } from '@/hooks/useApplicationAnswers';
import { savedAnswers, type AutofillAnswer, type AutofillResume } from '@/lib/autofill';
import { reportError } from '@/lib/observability';
import { ServiceError } from '@/lib/service';
import type { Job } from '@/types';
import { localDateKey } from '@/utils/week';

/**
 * §6, on screen: draft → review every field → hand off → confirm.
 *
 * ```
 * drafting ──► review ──(Open the form)──► handed off ──(I applied)──► tracked
 *    │            │                             │
 *    └► problem   └► close = abandon + refund   └► close = "not yet", run stays open
 * ```
 *
 * Three rules from §6 shape it, and each is enforced somewhere other than this file:
 *
 *  - **The reader sees every field before anything leaves the app.** The fields are one list
 *    with the hand-off button after the last of them, and `review_auto_apply` refuses a review
 *    whose `seen` keys do not cover the draft.
 *  - **Nothing invented is presented as fact.** Every null carries a prompt and every inferred
 *    answer is badged; the drafter guarantees both (`server/src/autoapply/draft.ts`).
 *  - **Credits are never decremented optimistically.** The balance on screen is re-read from
 *    the ledger after the server reserves, and again after a refund.
 *
 * Nothing here submits anything. The hand-off opens the employer's own form inside the app and
 * fills the reviewed answers into it (components/jobs/AutofillBrowser.tsx, lib/autofill.ts); the
 * reader presses the employer's Submit. That is §0 decision 2 kept: CareerDeck never sends an
 * application, it types into one the reader is looking at, like a browser's own autofill.
 */

type Step =
  | { kind: 'drafting' }
  | { kind: 'problem'; code: string | undefined; message: string }
  | { kind: 'review'; run: AutoApplyRun }
  | { kind: 'handedOff'; run: AutoApplyRun };

interface AutoApplySheetProps {
  job: Job | null;
  visible: boolean;
  onClose: () => void;
  /** The plain hand-off sheet, for when a draft is not possible or not wanted. */
  onApplyWithoutDraft: (job: Job) => void;
}

const POLL_MS = 2_000;

function displayValue(value: DraftField['value']): string {
  if (value === null) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

export function AutoApplySheet({ job, visible, onClose, onApplyWithoutDraft }: AutoApplySheetProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, credits } = useCareerDeck();
  const userId = user?.id ?? null;

  const [step, setStep] = useState<Step>({ kind: 'drafting' });
  const [values, setValues] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [resume, setResume] = useState<AutofillResume | null>(null);
  /** The run to abandon if the sheet closes before the hand-off. */
  const openRun = useRef<AutoApplyRun | null>(null);

  /*
   * The resume PDF, read while the reader reviews so it is ready to attach when the form opens.
   * Downloaded here and handed to the page as a data URL, so the page never needs a link to our
   * storage. A failure only means the reader attaches it by hand.
   */
  const resumeId = step.kind === 'review' || step.kind === 'handedOff' ? step.run.resumeId : null;
  useEffect(() => {
    if (!resumeId || resume) return;
    let cancelled = false;
    (async () => {
      const signed = await fetchResumeUrl(resumeId);
      const blob = await (await fetch(signed)).blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const fileName = `${[user?.firstName, user?.lastName].filter(Boolean).join('_') || 'Resume'}_Resume.pdf`;
      if (!cancelled) setResume({ dataUrl: dataUrl.replace(/^data:[^;]*;/, 'data:application/pdf;'), fileName });
    })().catch((error) => reportError(error, { where: 'AutoApplySheet.resume' }));
    return () => {
      cancelled = true;
    };
  }, [resumeId, resume, user?.firstName, user?.lastName]);

  /**
   * What the page gets filled with: every reviewed answer with a value first (they were written
   * for this posting), then the reader's saved answers for everything else a form asks.
   */
  const { answers: saved } = useApplicationAnswers(userId);
  const answers = useMemo<AutofillAnswer[]>(() => {
    if (step.kind !== 'review' && step.kind !== 'handedOff') return [];
    const drafted = step.run.fields
      .filter((f) => (f.role === 'answer' || f.role === 'contact') && (values[f.key] ?? '').trim() !== '')
      .map((f) => ({ key: f.key, label: f.label, value: values[f.key]!.trim(), kind: f.kind, options: f.options }));
    return [...drafted, ...savedAnswers(saved, user)];
  }, [step, values, saved, user]);

  const refreshAfterLedgerChange = credits.refresh;

  const showRun = useCallback((run: AutoApplyRun) => {
    openRun.current = run;
    if (run.status === 'ready') {
      setValues(Object.fromEntries(run.fields.map((f) => [f.key, displayValue(f.value)])));
      setEdited(new Set());
      setStep({ kind: 'review', run });
    } else if (run.status === 'reviewed') {
      setValues(Object.fromEntries(run.fields.map((f) => [f.key, displayValue(f.value)])));
      setStep({ kind: 'handedOff', run });
    } else if (run.status === 'failed') {
      openRun.current = null;
      setStep({
        kind: 'problem',
        code: 'failed',
        message: `${run.error ?? 'The draft could not be written.'} Your Auto Apply was returned.`,
      });
    } else if (run.status !== 'pending') {
      openRun.current = null;
      setStep({ kind: 'problem', code: 'closed', message: 'This draft is already closed.' });
    }
  }, []);

  /*
   * Start (or resume) a run when the sheet opens on a posting. The parent keys the sheet by
   * posting, so every open is a fresh mount and the initial `drafting` state is the reset.
   */
  useEffect(() => {
    if (!visible || !job) return;

    let cancelled = false;
    let poll: ReturnType<typeof setTimeout> | null = null;

    const follow = (runId: string) => {
      poll = setTimeout(async () => {
        try {
          const run = await fetchAutoApplyRun(runId);
          if (cancelled) return;
          if (run.status === 'pending') follow(runId);
          else showRun(run);
        } catch (error) {
          if (!cancelled) follow(runId);
          reportError(error, { where: 'AutoApplySheet.poll' });
        }
      }, POLL_MS);
    };

    startAutoApply(job.id)
      .then(({ run }) => {
        void refreshAfterLedgerChange();
        if (cancelled) return;
        if (run.status === 'pending') {
          openRun.current = run;
          follow(run.id);
        } else {
          showRun(run);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof ServiceError ? error.code : undefined;
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        if (!(error instanceof ServiceError) || error.status >= 500) {
          reportError(error, { where: 'AutoApplySheet.start' });
        }
        setStep({ kind: 'problem', code, message });
      });

    return () => {
      cancelled = true;
      if (poll) clearTimeout(poll);
    };
  }, [visible, job, showRun, refreshAfterLedgerChange]);

  /**
   * Closing before the hand-off abandons the run, and the credit comes back — the reader never
   * used what it bought. Closing after it is "not yet": the run stays reviewed so they can come
   * back and say they applied.
   */
  const close = useCallback(() => {
    const run = openRun.current;
    if (run && (step.kind === 'review' || step.kind === 'drafting')) {
      abandonAutoApply(run.id)
        .then(() => refreshAfterLedgerChange())
        .catch((error) => reportError(error, { where: 'AutoApplySheet.abandon' }));
    }
    openRun.current = null;
    onClose();
  }, [step.kind, onClose, refreshAfterLedgerChange]);

  const setField = useCallback((key: string, next: string) => {
    setValues((current) => ({ ...current, [key]: next }));
    setEdited((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);

  const handOff = useCallback(async () => {
    if (step.kind !== 'review' || !job) return;
    setBusy(true);
    try {
      await reviewAutoApply(step.run.id, step.run.fields.map((f) => f.key), [...edited]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep({ kind: 'handedOff', run: { ...step.run, status: 'reviewed' } });
      setBrowserOpen(true);
    } catch (error) {
      reportError(error, { where: 'AutoApplySheet.review' });
      setStep({ kind: 'problem', code: undefined, message: 'Could not save your review. Try again.' });
    } finally {
      setBusy(false);
    }
  }, [step, job, edited]);

  const confirmApplied = useCallback(async () => {
    if (step.kind !== 'handedOff') return;
    setBusy(true);
    try {
      await completeAutoApply(step.run.id, localDateKey());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBrowserOpen(false);
      openRun.current = null;
      void queryClient.invalidateQueries({ queryKey: applicationsKey(userId) });
      onClose();
    } catch (error) {
      reportError(error, { where: 'AutoApplySheet.complete' });
    } finally {
      setBusy(false);
    }
  }, [step, queryClient, userId, onClose]);

  if (!job) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close Auto Apply" />

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabber} />

        <View style={styles.header}>
          <Ionicons name="flash" size={16} color={colors.autoApply} />
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
            {job.title}
          </Text>
        </View>
        <Text style={styles.subtitle}>{job.companyName}</Text>

        {step.kind === 'drafting' ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.centerText}>Drafting from your resume…</Text>
          </View>
        ) : step.kind === 'problem' ? (
          <Problem
            code={step.code}
            message={step.message}
            onUpgrade={() => {
              close();
              router.push('/paywall');
            }}
            onApplyWithoutDraft={() => {
              onClose();
              onApplyWithoutDraft(job);
            }}
            onAddResume={() => {
              onClose();
              router.push('/(tabs)/activity');
            }}
            onClose={close}
          />
        ) : (
          <>
            <Text style={styles.notice}>
              {step.kind === 'review'
                ? 'Check your answers. Next, the application opens here with them filled in and your resume attached — you just review and submit.'
                : 'Your answers are filled in on the application. Reopen it to finish, or copy any answer below.'}
              {step.run.formSource === 'greenhouse' ? ' These are this posting’s real questions.' : ''}
            </Text>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {step.run.fields.map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? ''}
                  editable={step.kind === 'review'}
                  edited={edited.has(f.key)}
                  onChange={(next) => setField(f.key, next)}
                />
              ))}

              <View style={styles.actions}>
                {step.kind === 'review' ? (
                  <PrimaryButton
                    label="Autofill the application"
                    onPress={handOff}
                    loading={busy}
                    accessibilityHint="Opens the employer's application with your answers filled in. This uses the Auto Apply."
                  />
                ) : (
                  <>
                    <PrimaryButton label="Reopen the application" onPress={() => setBrowserOpen(true)} />
                    <PrimaryButton
                      label="I applied — track it"
                      variant="secondary"
                      onPress={confirmApplied}
                      loading={busy}
                      accessibilityHint="Adds this job to your Activity tracker as applied."
                    />
                  </>
                )}
                <PrimaryButton
                  label={step.kind === 'review' ? 'Discard draft' : 'Not yet'}
                  variant="ghost"
                  onPress={close}
                />
              </View>
            </ScrollView>
          </>
        )}
      </View>

      {browserOpen && step.kind === 'handedOff' ? (
        <AutofillBrowser
          runId={step.run.id}
          applyUrl={job.applicationUrl}
          answers={answers}
          resume={resume}
          companyName={job.companyName}
          onSubmitted={confirmApplied}
          onClose={() => setBrowserOpen(false)}
        />
      ) : null}
    </Modal>
  );
}

const SOURCE_LABEL: Partial<Record<DraftField['source'], string>> = {
  resume: 'From your resume',
  profile: 'From your profile',
  job: 'From the posting',
  contact: 'From your resume',
  inferred: 'Drafted',
};

function FieldRow({
  field,
  value,
  editable,
  edited,
  onChange,
}: {
  field: DraftField;
  value: string;
  editable: boolean;
  edited: boolean;
  onChange: (next: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 1_200);
  };

  const selfIdentify = field.role === 'self_identify';
  const attachment = field.role === 'attachment';
  const flagged = !selfIdentify && (value === '' || field.confidence === 'low');

  return (
    <View style={[styles.field, flagged && !edited ? styles.fieldFlagged : null]}>
      <View style={styles.fieldTop}>
        <Text style={styles.fieldLabel}>
          {field.label}
          {field.required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {!selfIdentify && !attachment && value ? (
          <Pressable onPress={copy} hitSlop={8} accessibilityLabel={`Copy ${field.label}`}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {selfIdentify || attachment ? (
        <Text style={styles.fieldStatic}>{value || '—'}</Text>
      ) : field.options && field.kind === 'select' ? (
        <View style={styles.options}>
          {field.options.map((option) => {
            const selected = value === option;
            return (
              <Pressable
                key={option}
                disabled={!editable}
                onPress={() => onChange(selected ? '' : option)}
                style={[styles.option, selected ? styles.optionSelected : null]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}>
                <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          editable={editable}
          multiline={field.kind === 'long_text' || field.kind === 'multi_select'}
          placeholder="Fill this in"
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, field.kind === 'long_text' ? styles.inputLong : null]}
          accessibilityLabel={field.label}
        />
      )}

      {field.prompt && !edited ? <Text style={styles.prompt}>{field.prompt}</Text> : null}
      {!selfIdentify && value && !edited && SOURCE_LABEL[field.source] ? (
        <Text style={styles.source}>
          {SOURCE_LABEL[field.source]}
          {field.confidence === 'low' ? ' · check this' : ''}
        </Text>
      ) : null}
    </View>
  );
}

function Problem({
  code,
  message,
  onUpgrade,
  onApplyWithoutDraft,
  onAddResume,
  onClose,
}: {
  code: string | undefined;
  message: string;
  onUpgrade: () => void;
  onApplyWithoutDraft: () => void;
  onAddResume: () => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { credits } = useCareerDeck();

  const headline =
    code === 'no_credits' ? 'No Auto Applies left today'
      : code === 'no_resume' ? 'Auto Apply needs a resume'
        : code === 'already_applied' ? 'Already in your tracker'
          : code === 'job_closed' ? 'This posting has closed'
            : 'Couldn’t draft this one';

  const detail =
    code === 'no_credits'
      ? credits.isPro
        ? `Your bank refills by ${credits.dailyGrant} a day. You can still apply without a draft.`
        : `You get ${credits.dailyGrant} a day. Pro gives you more — or apply without a draft.`
      : message;

  return (
    <View style={styles.problem}>
      <Text style={styles.problemTitle}>{headline}</Text>
      <Text style={styles.notice}>{detail}</Text>
      <View style={styles.actions}>
        {code === 'no_credits' && !credits.isPro ? <PrimaryButton label="See Pro" onPress={onUpgrade} /> : null}
        {code === 'no_resume' ? <PrimaryButton label="Add a resume" onPress={onAddResume} /> : null}
        {code !== 'already_applied' && code !== 'job_closed' ? (
          <PrimaryButton
            label="Apply without a draft"
            variant={code === 'no_credits' || code === 'no_resume' ? 'secondary' : 'primary'}
            onPress={onApplyWithoutDraft}
          />
        ) : null}
        <PrimaryButton label="Close" variant="ghost" onPress={onClose} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '88%',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  notice: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  center: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl * 2,
  },
  centerText: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  field: {
    backgroundColor: colors.backgroundMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  fieldFlagged: {
    borderColor: colors.autoApply,
  },
  fieldTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  fieldLabel: {
    flex: 1,
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  required: {
    color: colors.danger,
  },
  fieldStatic: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  input: {
    fontSize: fontSize.small,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  inputLong: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  optionSelected: {
    borderColor: colors.autoApply,
    backgroundColor: colors.autoApplySurface,
  },
  optionText: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  optionTextSelected: {
    color: colors.autoApplyLabel,
    fontWeight: '600',
  },
  prompt: {
    fontSize: fontSize.caption,
    color: colors.autoApply,
    lineHeight: 16,
  },
  source: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  actions: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  problem: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  problemTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
}));
