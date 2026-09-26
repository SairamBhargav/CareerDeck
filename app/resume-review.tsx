import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { MarqueeText } from '@/components/common/MarqueeText';
import { PrimaryButton } from '@/components/common/PrimaryButton';
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
 *
 * ── How it is laid out, and why that changed ──────────────────────────────────
 *
 * This screen asks for corrections, so its whole job is to make "what was read" scannable and
 * "what is wrong" tappable. It used to be one flat column with a uniform gap between every
 * element, which meant a section heading, its hint, a row of chips and a text input all sat
 * the same distance apart — nothing grouped, so everything read as one undifferentiated form,
 * and education and experience were bare lines of text run together.
 *
 * Now each question is a card: heading, one line of why it matters, and the control. Cards
 * group, the gaps between them separate, and the confirm action is pinned to the bottom
 * instead of floating at the end of a scroll whose length depends on how many skills the
 * parser found.
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

  const parsed = resume.parseStatus === 'parsed';
  const pageCount = resume.pageCount;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <IconButton name="close" accessibilityLabel="Close" onPress={() => router.back()} surface />
        <View style={styles.headerText}>
          {/* Same travelling line as the shelf and the viewer — one name, one treatment. */}
          <MarqueeText style={styles.title}>{resume.name}</MarqueeText>
          {/*
            The page count is the one piece of evidence that the model read the document the
            user actually sent, rather than a blank or a cover letter.
          */}
          {parsed && pageCount !== null ? (
            <Text style={styles.subtitle}>
              {pageCount} {pageCount === 1 ? 'page' : 'pages'} read
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {resume.parseStatus === 'parsing' ? (
          <View style={styles.notice}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={styles.body}>Reading your resume…</Text>
          </View>
        ) : null}

        {resume.parseStatus === 'failed' ? (
          <View style={[styles.notice, styles.noticeBad]}>
            <View style={styles.noticeHead}>
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={styles.noticeTitle}>Could not read this one</Text>
            </View>
            <Text style={styles.hint}>
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

        {parsed ? (
          <>
            <Text style={styles.lede}>
              Here is what we read. Fix anything that is wrong — this is what your match scores
              are calculated from.
            </Text>

            {/* ── Skills ─────────────────────────────────────────────────── */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Skills</Text>
                <Text style={styles.cardCount}>{shownSkills.length}</Text>
              </View>
              <Text style={styles.hint}>
                Matched against each posting&apos;s own skills. The more accurate these are, the
                more the number on a card means.
              </Text>

              {shownSkills.length > 0 ? (
                <View style={styles.chips}>
                  {shownSkills.map((skill) => (
                    <Pressable
                      key={skill}
                      onPress={() => setSkills(shownSkills.filter((entry) => entry !== skill))}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${skill}`}
                      hitSlop={4}
                      style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}>
                      <Text style={styles.chipLabel}>{skill}</Text>
                      {/*
                        An explicit ×. Tapping a chip to delete it is the interaction either
                        way, but without the glyph nothing on screen says so, and a chip that
                        silently vanishes when touched reads as a bug.
                      */}
                      <Ionicons name="close" size={13} color={colors.textTertiary} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.empty}>Nothing found. Add the ones that matter most.</Text>
              )}

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
                <PrimaryButton
                  label="Add"
                  variant="secondary"
                  onPress={addSkill}
                  style={styles.addButton}
                />
              </View>
            </View>

            {/* ── Level ──────────────────────────────────────────────────── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Level</Text>
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
                      <Text
                        style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* ── Location and years ─────────────────────────────────────── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Location</Text>
              <TextInput
                value={shownLocation}
                onChangeText={setLocation}
                placeholder="City, state"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
              />
              {years !== null ? (
                <View style={styles.inlineFact}>
                  <Ionicons name="time-outline" size={15} color={colors.textTertiary} />
                  <Text style={styles.hint}>
                    {years} {years === 1 ? 'year' : 'years'} of experience, from the dates on the
                    page.
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ── Also read ──────────────────────────────────────────────── */}
            {education.length > 0 || experience.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Also read</Text>
                <Text style={styles.hint}>
                  Kept on file, not used for matching yet. Re-upload if any of it is wrong.
                </Text>

                <View style={styles.entries}>
                  {education.map((entry, index) => (
                    <View key={`edu-${index}`} style={styles.entry}>
                      <Ionicons name="school-outline" size={17} color={colors.textTertiary} />
                      <View style={styles.entryText}>
                        <Text style={styles.entryTitle}>
                          {[entry.degree, entry.field].filter(Boolean).join(', ') || 'Education'}
                        </Text>
                        <Text style={styles.entryMeta}>
                          {[entry.school, entry.graduationYear].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </View>
                  ))}

                  {experience.map((entry, index) => (
                    <View key={`exp-${index}`} style={styles.entry}>
                      <Ionicons name="briefcase-outline" size={17} color={colors.textTertiary} />
                      <View style={styles.entryText}>
                        <Text style={styles.entryTitle}>{entry.title ?? 'Role'}</Text>
                        <Text style={styles.entryMeta}>
                          {[entry.company, entry.isCurrent ? 'current' : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/*
             * The contact fields, named and not shown. The user cannot otherwise tell whether
             * the extractor found an email — and that is the only part worth telling them,
             * because the value itself is already theirs. PHASE4.md §4.4.
             */}
            <View style={styles.sealed}>
              <Ionicons name="lock-closed" size={15} color={colors.textTertiary} />
              <Text style={styles.hint}>
                Your name, email and phone were read and encrypted. They are never shown back in
                the app, and are only used to fill in an application you ask us to.
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>

      {/*
        Pinned, not appended. The confirm action used to sit at the end of the scroll, so how
        far the user had to travel to reach it depended on how many skills the parser happened
        to find — on a dense resume the primary action was three screens down.
      */}
      {parsed ? (
        <View style={styles.footer}>
          {error !== null ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton
            label={resume.profile.confirmedAt ? 'Save changes' : 'Looks right'}
            disabled={!canConfirm}
            onPress={() => void handleConfirm()}
          />
        </View>
      ) : null}
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
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    marginTop: 1,
  },
  content: {
    padding: screenPadding,
    paddingTop: 0,
    paddingBottom: spacing.xl,
    // The separation between cards. Inside a card the gap is tighter, which is what makes
    // each one read as a single question.
    gap: spacing.md,
  },
  lede: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    lineHeight: 21,
  },

  /* ── cards ──────────────────────────────────────────────────────────────── */
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  cardCount: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  hint: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    lineHeight: 17,
  },
  body: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  empty: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontStyle: 'italic',
    paddingVertical: spacing.xs,
  },

  /* ── notices ────────────────────────────────────────────────────────────── */
  notice: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
    alignItems: 'flex-start',
  },
  noticeBad: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  noticeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  noticeTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },

  /* ── skill chips ────────────────────────────────────────────────────────── */
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.backgroundMuted,
    borderColor: colors.border,
  },
  chipPressed: {
    opacity: 0.55,
  },
  chipLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  /* ── inputs ─────────────────────────────────────────────────────────────── */
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: minTapTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: fontSize.body,
  },
  addButton: {
    paddingHorizontal: spacing.lg,
    minHeight: minTapTarget,
  },
  inlineFact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  /* ── level pills ────────────────────────────────────────────────────────── */
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  optionLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  optionLabelSelected: {
    color: colors.accentText,
  },

  /* ── education / experience rows ────────────────────────────────────────── */
  entries: {
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  entryText: {
    flex: 1,
    minWidth: 0,
  },
  entryTitle: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  entryMeta: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    marginTop: 1,
  },

  /* ── sealed contact notice ──────────────────────────────────────────────── */
  sealed: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundMuted,
  },

  /* ── pinned footer ──────────────────────────────────────────────────────── */
  footer: {
    gap: spacing.sm,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  error: {
    fontSize: fontSize.caption,
    color: colors.danger,
  },
}));
