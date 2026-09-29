import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { ApplicationAnswers } from '@/lib/api';

interface ApplicationAnswersSheetProps {
  answers: ApplicationAnswers;
  onSave: (answers: ApplicationAnswers) => void;
  onClose: () => void;
}

type TextKey = 'degree' | 'fieldOfStudy' | 'linkedinUrl' | 'githubUrl' | 'portfolioUrl' | 'earliestStart';
type ChoiceKey = 'workAuthorizedUs' | 'needsSponsorship' | 'willingToRelocate';

/**
 * The questions every application asks, answered once — docs/PHASE8.md §5.
 *
 * Degree and field arrive from the resume and say so. Work authorization and sponsorship never
 * do: nothing infers them, and an unanswered one stays unanswered rather than defaulting to
 * either side. Auto Apply reads these as the student's own statements.
 *
 * Edits are held locally and committed on Save, like the preferences sheet beside it.
 */
export function ApplicationAnswersSheet({ answers, onSave, onClose }: ApplicationAnswersSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(answers);

  const dirty = JSON.stringify(draft) !== JSON.stringify(answers);

  const setText = (key: TextKey, value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: value,
      // Once the student edits a resume-filled answer it is theirs, and says so.
      fromResume: current.fromResume.filter((field) => field !== key),
    }));
  };

  const setChoice = (key: ChoiceKey, value: boolean | null) => {
    Haptics.selectionAsync();
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close application answers" />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.lift}
        pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(260)}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title} accessibilityRole="header">
                Application answers
              </Text>
              <Text style={styles.subtitle}>Asked on almost every application. Auto Apply uses them.</Text>
            </View>

            <Pressable
              onPress={() => onSave(draft)}
              disabled={!dirty}
              accessibilityRole="button"
              accessibilityLabel="Save application answers"
              accessibilityState={{ disabled: !dirty }}
              style={({ pressed }) => [styles.save, dirty ? styles.saveActive : null, pressed ? styles.pressed : null]}>
              <Text style={[styles.saveLabel, dirty ? styles.saveLabelActive : null]}>Save</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.fields}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.group}>Education</Text>
            <Field
              label="Degree"
              placeholder="B.S."
              value={draft.degree}
              fromResume={draft.fromResume.includes('degree')}
              onChange={(value) => setText('degree', value)}
            />
            <Field
              label="Field of study"
              placeholder="Computer Science"
              value={draft.fieldOfStudy}
              fromResume={draft.fromResume.includes('fieldOfStudy')}
              onChange={(value) => setText('fieldOfStudy', value)}
            />

            <Text style={styles.group}>Work eligibility</Text>
            <Choice
              label="Authorized to work in the US?"
              value={draft.workAuthorizedUs}
              onChange={(value) => setChoice('workAuthorizedUs', value)}
            />
            <Choice
              label="Need visa sponsorship, now or later?"
              value={draft.needsSponsorship}
              onChange={(value) => setChoice('needsSponsorship', value)}
            />

            <Text style={styles.group}>Links</Text>
            <Field
              label="LinkedIn"
              placeholder="linkedin.com/in/you"
              value={draft.linkedinUrl}
              onChange={(value) => setText('linkedinUrl', value)}
              link
            />
            <Field
              label="GitHub"
              placeholder="github.com/you"
              value={draft.githubUrl}
              onChange={(value) => setText('githubUrl', value)}
              link
            />
            <Field
              label="Portfolio or website"
              placeholder="you.dev"
              value={draft.portfolioUrl}
              onChange={(value) => setText('portfolioUrl', value)}
              link
            />

            <Text style={styles.group}>Availability</Text>
            <Field
              label="Earliest start"
              placeholder="May 2027"
              value={draft.earliestStart}
              onChange={(value) => setText('earliestStart', value)}
            />
            <Choice
              label="Willing to relocate?"
              value={draft.willingToRelocate}
              onChange={(value) => setChoice('willingToRelocate', value)}
            />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface FieldProps {
  label: string;
  placeholder: string;
  value: string | null;
  onChange: (value: string) => void;
  fromResume?: boolean;
  link?: boolean;
}

function Field({ label, placeholder, value, onChange, fromResume = false, link = false }: FieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {fromResume ? <Text style={styles.fromResume}>From your resume</Text> : null}
      </View>
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        autoCapitalize={link ? 'none' : 'sentences'}
        autoCorrect={!link}
        keyboardType={link ? 'url' : 'default'}
        maxLength={link ? 200 : 80}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

interface ChoiceProps {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}

/**
 * Yes, No, or not answered. Tapping the selected side again clears it, because "I'd rather not
 * say here" is a real answer to a sponsorship question and there has to be a way back to it.
 */
function Choice({ label, value, onChange }: ChoiceProps) {
  const styles = useStyles();
  const options: { label: string; value: boolean }[] = [
    { label: 'Yes', value: true },
    { label: 'No', value: false },
  ];
  return (
    <View style={styles.choiceRow}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.label}
              onPress={() => onChange(selected ? null : option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label} ${option.label}`}
              style={({ pressed }) => [
                styles.segment,
                selected ? styles.segmentSelected : null,
                pressed ? styles.pressed : null,
              ]}>
              <Text style={[styles.segmentLabel, selected ? styles.segmentLabelSelected : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  lift: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    gap: spacing.lg,
    maxHeight: '88%',
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.xs,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  save: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  saveActive: {
    backgroundColor: colors.accent,
  },
  saveLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  saveLabelActive: {
    color: colors.accentText,
  },
  pressed: {
    opacity: 0.7,
  },
  scroll: {
    flexGrow: 0,
  },
  fields: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  group: {
    marginTop: spacing.sm,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  field: {
    gap: spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  fromResume: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: fontSize.body,
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  choiceLabel: {
    flex: 1,
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  segments: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  segment: {
    minWidth: 52,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  segmentSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  segmentLabelSelected: {
    color: colors.accentText,
  },
}));
