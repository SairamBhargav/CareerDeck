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
import type { User, UserIdentityEdit } from '@/types';

/** Graduation years offered. A student picking a year twenty out is a typo, not a plan. */
const GRAD_YEAR_SPAN = 6;

interface EditProfileSheetProps {
  user: User;
  onSave: (edit: UserIdentityEdit) => void;
  onClose: () => void;
}

/**
 * Edits the identity block: name, school, major, graduation year, location.
 *
 * Nothing here is validated beyond "a name has to have something in it". These are
 * the user's own details, and a form that argues with someone about how their school
 * is spelled is worse than one that takes them at their word.
 *
 * The caller mounts this only while it's open, so the draft seeds itself on each visit
 * and an abandoned edit can't survive into the next one.
 */
export function EditProfileSheet({ user, onSave, onClose }: EditProfileSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<UserIdentityEdit>(() => identityOf(user));

  const set = <K extends keyof UserIdentityEdit>(key: K, value: UserIdentityEdit[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const nameGiven = draft.firstName.trim().length > 0 && draft.lastName.trim().length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(identityOf(user));
  const canSave = nameGiven && dirty;

  const years = Array.from({ length: GRAD_YEAR_SPAN }, (_, index) => thisYear() + index);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close profile editor" />
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
            <Text style={styles.title} accessibilityRole="header">
              Edit profile
            </Text>

            <Pressable
              onPress={() => onSave(trimmed(draft))}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel="Save profile"
              accessibilityState={{ disabled: !canSave }}
              style={({ pressed }) => [
                styles.save,
                canSave ? styles.saveActive : null,
                pressed ? styles.pressed : null,
              ]}>
              <Text style={[styles.saveLabel, canSave ? styles.saveLabelActive : null]}>Save</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.pair}>
              <Field
                label="First name"
                value={draft.firstName}
                onChangeText={(value) => set('firstName', value)}
                autoCapitalize="words"
                style={styles.half}
              />
              <Field
                label="Last name"
                value={draft.lastName}
                onChangeText={(value) => set('lastName', value)}
                autoCapitalize="words"
                style={styles.half}
              />
            </View>

            <Field label="School" value={draft.school} onChangeText={(value) => set('school', value)} />
            <Field label="Major" value={draft.major} onChangeText={(value) => set('major', value)} />
            <Field
              label="Location"
              value={draft.location}
              onChangeText={(value) => set('location', value)}
              autoCapitalize="words"
            />

            <View style={styles.field}>
              <Text style={styles.label}>Graduating</Text>
              {/* A row of years rather than a free field: the value is a small, known
                  set, and a keyboard is a slow way to pick one of six things. */}
              <View style={styles.years}>
                {years.map((year) => {
                  const selected = year === draft.graduationYear;
                  return (
                    <Pressable
                      key={year}
                      onPress={() => set('graduationYear', year)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Class of ${year}`}
                      style={({ pressed }) => [
                        styles.year,
                        selected ? styles.yearSelected : null,
                        pressed ? styles.pressed : null,
                      ]}>
                      <Text style={[styles.yearLabel, selected ? styles.yearLabelSelected : null]}>
                        {String(year).slice(2)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {!nameGiven ? <Text style={styles.warning}>A first and last name are needed to save.</Text> : null}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  style?: object;
}

function Field({ label, value, onChangeText, autoCapitalize = 'sentences', style }: FieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

function identityOf(user: User): UserIdentityEdit {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    school: user.school,
    major: user.major,
    graduationYear: user.graduationYear,
    location: user.location,
  };
}

function trimmed(edit: UserIdentityEdit): UserIdentityEdit {
  return {
    ...edit,
    firstName: edit.firstName.trim(),
    lastName: edit.lastName.trim(),
    school: edit.school.trim(),
    major: edit.major.trim(),
    location: edit.location.trim(),
  };
}

function thisYear(): number {
  return new Date().getFullYear();
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
    gap: spacing.md,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    // Leaves the page visible above it, so the sheet reads as sitting over Profile
    // rather than having replaced it.
    maxHeight: '88%',
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
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
  form: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  pair: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
  years: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  year: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  yearSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  yearLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  yearLabelSelected: {
    color: colors.accentText,
  },
  warning: {
    fontSize: fontSize.caption + 1,
    color: colors.textTertiary,
  },
}));
