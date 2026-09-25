import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { SkillChip } from '@/components/common/SkillChip';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useResumes } from '@/hooks/useResumes';
import type { ResumeSeniority } from '@/types';

/**
 * The parse-confirmation screen — README §3.9, and the reason that section says the extra
 * onboarding step is worth it.
 *
 * §3.9 gives three reasons and this screen is built around all three:
 *
 *  1. **It fixes the ~15% the parser gets wrong.** A model reading a two-column PDF will miss a
 *     skill, mis-read a graduation year, or decide a student with two internships is `mid`. Every
 *     one of those goes straight into a match score, so the cheapest correction mechanism
 *     available is the person who wrote the document.
 *  2. **It is a consent moment you can point at.** The user sees what was extracted from their
 *     resume before it is used, and `user_confirmed_at` is the timestamp that says so.
 *  3. **It is labeled data on parser accuracy, free.** `confirmed_fields` records which fields
 *     the user actually changed, so "how good is the extractor" becomes a query instead of an
 *     opinion.
 *
 * ── What is deliberately not on this screen ───────────────────────────────────
 *
 * Name, email and phone. The extractor finds them and seals them with a key the database does
 * not have, and nothing in this phase opens them again — showing somebody their own phone
 * number back costs a decryption, a `pii_access_log` row and a plaintext P0 field on the wire,
 * in exchange for confirming a fact they already know. The screen says the three were *found*,
 * which is the part the user cannot otherwise tell. PHASE4.md §4.4.
 */

const SENIORITY_OPTIONS: { value: ResumeSeniority; label: string }[] = [
  { value: 'intern', label: 'Intern' },
  { value: 'new_grad', label: 'New grad' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'staff_plus', label: 'Staff+' },
];

export default function ResumeReviewScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const { userId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { resumes, isLoading, confirm, parse, isBusy } = useResumes(userId);
  const resume = resumes.find((entry) => entry.id === id);

  /*
   * Edits live here and are only sent on Confirm.
   *
   * `undefined` means "untouched", which is what lets `confirm_resume_profile` tell a field the
   * user corrected from one they simply did not open — that distinction is the whole value of
   * `confirmed_fields` as accuracy data.
   */
  const [skills, setSkills] = useState<string[] | undefined>();
  const [seniority, setSeniority] = useState<ResumeSeniority | null | undefined>();
  const [location, setLocation] = useState<string | undefined>();
  const [draftSkill, setDraftSkill] = useState('');
  const [error, setError] = useState<string | null>(null);

  const shownSkills = skills ?? resume?.profile.skills ?? [];
  const shownSeniority = seniority === undefined ? (resume?.profile.seniority ?? null) : seniority;
  const shownLocation = location ?? resume?.profile.location ?? '';

  const years = resume?.profile.yearsExperience ?? null;

  const education = resume?.profile.education ?? [];
  const experience = resume?.profile.experience ?? [];

  const canConfirm = resume?.parseStatus === 'parsed' && !isBusy;

  const addSkill = () => {
    const slug = draftSkill
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9+#.\- ]/g, '')
      .replace(/\s+/g, '-');
    if (slug.length < 2 || shownSkills.includes(slug)) {
      setDraftSkill('');
      return;
    }
    setSkills([...shownSkills, slug]);
    setDraftSkill('');
  };

  const handleConfirm = async () => {
    if (!resume) return;
    setError(null);
    try {
      await confirm(resume.id, {
        skills,
        seniority,
        location: location?.trim() === '' ? null : location,
      });
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not save. Try again.');
    }
  };

  if (isLoading && !resume) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!resume) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.body}>That resume is no longer here.</Text>
          <PrimaryButton label="Go back" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <IconButton name="close" accessibilityLabel="Close" onPress={() => router.back()} surface />
        <Text style={styles.title} numberOfLines={1}>
          {resume.name}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {resume.parseStatus === 'parsing' ? (
          <View style={styles.notice}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={styles.body}>Reading your resume…</Text>
          </View>
        ) : null}

        {resume.parseStatus === 'failed' ? (
          <View style={[styles.notice, styles.noticeBad]}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
            <Text style={styles.body}>
              {resume.parseError ?? 'That document could not be read.'}
            </Text>
            <PrimaryButton
              label="Try again"
              variant="secondary"
              disabled={isBusy}
              onPress={() => void parse(resume.id)}
            />
          </View>
        ) : null}

        {resume.parseStatus === 'parsed' ? (
          <>
            <Text style={styles.lede}>
              Here is what we read. Fix anything that is wrong — this is what your match scores
              are calculated from.
            </Text>

            <SectionHeader title="Skills" />
            <Text style={styles.hint}>
              These are matched against each posting&apos;s own skills. The more accurate they are,
              the more the number on a card means.
            </Text>
            <View style={styles.chips}>
              {shownSkills.map((skill) => (
                <Pressable
                  key={skill}
                  onPress={() => setSkills(shownSkills.filter((entry) => entry !== skill))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${skill}`}>
                  <SkillChip label={skill} />
                </Pressable>
              ))}
              {shownSkills.length === 0 ? (
                <Text style={styles.hint}>Nothing found. Add the ones that matter most.</Text>
              ) : null}
            </View>

            <View style={styles.addRow}>
              <TextInput
                value={draftSkill}
                onChangeText={setDraftSkill}
                onSubmitEditing={addSkill}
                placeholder="Add a skill"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                style={styles.input}
              />
              <PrimaryButton label="Add" variant="secondary" onPress={addSkill} />
            </View>

            <SectionHeader title="Level" />
            <Text style={styles.hint}>
              What you are applying as, not what you have done. This decides whether a senior
              posting counts against you.
            </Text>
            <View style={styles.chips}>
              {SENIORITY_OPTIONS.map((option) => {
                const selected = shownSeniority === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setSeniority(selected ? null : option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.option, selected ? styles.optionSelected : null]}>
                    <Text style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionHeader title="Location" />
            <TextInput
              value={shownLocation}
              onChangeText={setLocation}
              placeholder="City, state"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
            />

            {years !== null ? (
              <Text style={styles.hint}>
                {years} {years === 1 ? 'year' : 'years'} of experience, from the dates on the page.
              </Text>
            ) : null}

            {education.length > 0 || experience.length > 0 ? (
              <>
                <SectionHeader title="Also read" />
                <Text style={styles.hint}>
                  Kept on file, not used for matching yet. Re-upload if any of it is wrong.
                </Text>
                {education.map((entry, index) => (
                  <Text key={`edu-${index}`} style={styles.body}>
                    {[entry.degree, entry.field, entry.school].filter(Boolean).join(' · ')}
                    {entry.graduationYear ? ` (${entry.graduationYear})` : ''}
                  </Text>
                ))}
                {experience.map((entry, index) => (
                  <Text key={`exp-${index}`} style={styles.body}>
                    {[entry.title, entry.company].filter(Boolean).join(' · ')}
                    {entry.isCurrent ? ' (current)' : ''}
                  </Text>
                ))}
              </>
            ) : null}

            {/*
             * The contact fields, named and not shown. The user cannot otherwise tell whether
             * the extractor found an email — and that is the only part worth telling them,
             * because the value itself is already theirs. PHASE4.md §4.4.
             */}
            <View style={styles.sealed}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.textTertiary} />
              <Text style={styles.hint}>
                Your name, email and phone were read and encrypted. They are never shown back in
                the app and are only used to fill in an application you ask us to.
              </Text>
            </View>

            {error !== null ? <Text style={styles.error}>{error}</Text> : null}

            <PrimaryButton
              label={resume.profile.confirmedAt ? 'Save changes' : 'Looks right'}
              disabled={!canConfirm}
              onPress={() => void handleConfirm()}
              style={styles.confirm}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: screenPadding,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
  },
  content: {
    padding: screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  lede: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    lineHeight: 17,
  },
  body: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  notice: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
    alignItems: 'flex-start',
  },
  noticeBad: {
    borderWidth: 1,
    borderColor: colors.danger,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: minTapTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.body,
  },
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  optionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  optionLabelSelected: {
    color: colors.accentText,
  },
  sealed: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
  },
  error: {
    fontSize: fontSize.caption,
    color: colors.danger,
  },
  confirm: {
    marginTop: spacing.lg,
  },
}));
