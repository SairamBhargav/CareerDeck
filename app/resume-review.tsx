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
 * Each question is a card: heading, one line of why it matters, and the control. The confirm
 * action is pinned to the bottom rather than appended, so how far it is does not depend on how
 * many skills the parser happened to find.
 *
 * **The cards are in weight order, and each one says what it is worth.** That is the whole
 * organising idea, and it came from the screen being wrong rather than merely untidy: the cards
 * were in no particular order, and education and experience sat last under a heading that said
 * "Kept on file, not used for matching yet". That stopped being true when the scorer reached v3
 * (20261024000000_match_score_v3.sql) — work now carries the field, and the two of them are
 * `experience` 0.25 plus `field` 0.20, so the screen was filing 45% of a reader's score under
 * "not used" at the bottom of a scroll.
 *
 * So: skills, experience, education, level, by what each moves, with the number on the card.
 * A reader who will fix one thing fixes the thing that pays. README §13.3 wants an automated
 * score to be answerable; this answers it before the score exists rather than after.
 *
 * Location sits last and carries no percentage. v3 dropped it from the match — "experience
 * replaces location" — but the feed ranker still reads it, so it is neither scored nor inert,
 * and it says that instead of pretending to either.
 *
 * ── Gaps before fields ────────────────────────────────────────────────────────
 *
 * An empty control and a correctly-empty control look identical in a form. A blank location box
 * does not say whether the parser missed it or the resume never had one, and a reader cannot
 * act on that. The gap list at the top names only the blanks that cost score, with what they
 * cost — a blank that costs nothing is left out, because listing it would teach people to skip
 * the list.
 */

/*
 * What each part of the resume is worth, from 20261024000000_match_score_v3.sql's header:
 *
 *   skills 0.40 · experience 0.25 · field 0.20 · seniority 0.15
 *
 * On screen because this page asks for corrections, and the only honest answer to "which of
 * these should I fix first" is how much each one moves. README §13.3 asks that an automated
 * score be answerable; this is that answer, given before the score rather than after it.
 *
 * **Copied from SQL, so it drifts when the scorer moves.** The migration is the source of
 * truth. A v4 that reweights anything has to change these four numbers in the same commit.
 */
const WEIGHT = { skills: 40, experience: 25, field: 20, seniority: 15 } as const;

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

  /*
   * The blanks that cost something, in weight order.
   *
   * Only the ones that change a score. A missing location is not here — it is not scored — and
   * neither is a missing degree on its own, because a relevant role carries the field instead.
   * Naming a blank that costs nothing would train people to ignore the ones that do.
   */
  const gaps: string[] = [];
  if (shownSkills.length === 0) {
    gaps.push(`No skills were read. They are ${WEIGHT.skills}% of every match score — the largest single piece.`);
  }
  if (experience.length === 0) {
    gaps.push(`No roles were read. Past roles are ${WEIGHT.experience}%, and they carry your field when your degree does not.`);
  }
  if (education.length === 0 && experience.length === 0) {
    gaps.push(`Neither a degree nor a role was read, so the ${WEIGHT.field}% for field has nothing to work from.`);
  }
  if (shownSeniority === null) {
    gaps.push(`No level is set. It is ${WEIGHT.seniority}%, and it is the one thing here the document often does not say.`);
  }

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
              This is what we read, in the order it matters. Fixing the top of this list moves your
              match scores more than fixing the bottom.
            </Text>

            {/*
              * What is missing, before what is there.
              *
              * An empty field and a correctly-empty field look identical in a form — a blank
              * location box says nothing about whether the parser failed or the resume never said.
              * These are the gaps that cost something, named with what they cost, so the reader
              * knows whether the blank is worth their attention.
              */}
            {gaps.length > 0 ? (
              <View style={styles.gaps}>
                <View style={styles.gapsHead}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.text} />
                  <Text style={styles.gapsTitle}>
                    {gaps.length === 1 ? 'One thing is missing' : `${gaps.length} things are missing`}
                  </Text>
                </View>
                {gaps.map((gap) => (
                  <Text key={gap} style={styles.gapLine}>
                    {gap}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* ── Skills · 40% ───────────────────────────────────────────── */}
            <View style={styles.card}>
              <SectionHead title="Skills" weight={WEIGHT.skills} count={shownSkills.length} />
              <Text style={styles.hint}>
                Checked against each posting&apos;s own list. Required ones count double what
                nice-to-haves do, and 60% coverage already scores full marks.
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

            {/* ── Experience · 25% ───────────────────────────────────────── */}
            <View style={styles.card}>
              <SectionHead title="Experience" weight={WEIGHT.experience} count={experience.length} />
              <Text style={styles.hint}>
                {experience.length > 0
                  ? 'A role counts when its field is close to the posting’s, and a longer one counts for more. This is also what carries your field when your degree is in something else.'
                  : 'Roles close to a posting’s field are a quarter of its score. None were read from this document.'}
              </Text>

              {experience.length > 0 ? (
                <View style={styles.entries}>
                  {experience.map((entry, index) => (
                    <View key={`exp-${index}`} style={styles.entry}>
                      <Ionicons name="briefcase-outline" size={17} color={colors.textTertiary} />
                      <View style={styles.entryText}>
                        <Text style={styles.entryTitle}>{entry.title ?? 'Role'}</Text>
                        <Text style={styles.entryMeta}>
                          {[entry.company, entry.isCurrent ? 'current' : null]
                            .filter(Boolean)
                            .join(' · ') || 'Company not read'}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              {years !== null ? (
                <View style={styles.inlineFact}>
                  <Ionicons name="time-outline" size={15} color={colors.textTertiary} />
                  <Text style={styles.hint}>
                    {years} {years === 1 ? 'year' : 'years'} in total, from the dates on the page.
                  </Text>
                </View>
              ) : null}

              <Text style={styles.readOnly}>Read from the document. Re-upload to change it.</Text>
            </View>

            {/* ── Education · 20% ────────────────────────────────────────── */}
            <View style={styles.card}>
              <SectionHead title="Education" weight={WEIGHT.field} count={education.length} />
              <Text style={styles.hint}>
                Your degree against the posting&apos;s field. A relevant past role can carry this
                instead, so a maths major with software internships is not outside the field.
              </Text>

              {education.length > 0 ? (
                <View style={styles.entries}>
                  {education.map((entry, index) => (
                    <View key={`edu-${index}`} style={styles.entry}>
                      <Ionicons name="school-outline" size={17} color={colors.textTertiary} />
                      <View style={styles.entryText}>
                        <Text style={styles.entryTitle}>
                          {[entry.degree, entry.field].filter(Boolean).join(', ') || 'Education'}
                        </Text>
                        <Text style={styles.entryMeta}>
                          {[entry.school, entry.graduationYear].filter(Boolean).join(' · ') ||
                            'School not read'}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.empty}>Nothing found. Your field comes from your roles instead.</Text>
              )}

              <Text style={styles.readOnly}>Read from the document. Re-upload to change it.</Text>
            </View>

            {/* ── Level · 15% ────────────────────────────────────────────── */}
            <View style={styles.card}>
              <SectionHead title="Level" weight={WEIGHT.seniority} />
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

            {/* ── Location · not scored ──────────────────────────────────── */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Location</Text>
                {/*
                  * Deliberately not a percentage.
                  *
                  * v3 of the scorer dropped location from the match entirely — "experience
                  * replaces location" — but the feed ranker still reads it to decide what you are
                  * shown. Leaving it in the list unlabelled would imply it scores; labelling it
                  * 0% would imply it does nothing.
                  */}
                <Text style={styles.cardAside}>orders your feed</Text>
              </View>
              <Text style={styles.hint}>
                Not part of a match score. It decides which postings reach you in the first place.
              </Text>
              <TextInput
                value={shownLocation}
                onChangeText={setLocation}
                placeholder="City, state"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
              />
            </View>

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

/**
 * A section's name, what it is worth, and how many of it were found.
 *
 * The weight is the point. Every card used to look equally important, so the reader had no way
 * to tell that correcting one skill is worth more than correcting a job title — and the card
 * carrying nearly half the score was at the bottom under "Also read".
 */
function SectionHead({ title, weight, count }: { title: string; weight: number; count?: number }) {
  const styles = useStyles();

  return (
    <View style={styles.cardHead}>
      <View style={styles.cardHeadLeft}>
        <Text style={styles.cardTitle}>{title}</Text>
        {count === undefined ? null : <Text style={styles.cardCount}>{count}</Text>}
      </View>
      <View style={styles.weightPill}>
        <Text style={styles.weightPillText}>{weight}% of your match</Text>
      </View>
    </View>
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
  cardHeadLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  // Quiet by design: it ranks the sections, it is not a thing to read on every one of them.
  weightPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  weightPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  // The one thing above the fold that is not a field: what the parse did not find.
  gaps: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
  },
  gapsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 2,
  },
  gapsTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  gapLine: {
    fontSize: fontSize.caption,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  // Says why there is no control here, so a section with nothing to tap does not read as broken.
  readOnly: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  // Location's stand-in for a weight: it is not scored, but it is not inert either.
  cardAside: {
    fontSize: 10,
    fontWeight: '700',
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
