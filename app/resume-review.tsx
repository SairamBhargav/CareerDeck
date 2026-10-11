import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
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
 * ── How it is laid out ───────────────────────────────────────────────────────
 *
 * A label column and a content column, divided by hairlines. No cards, no fills, no section
 * headings at body size — one title, then six rows. The label column is what makes it scan: a
 * reader looking for what it made of their degree runs down a narrow column of single words,
 * rather than reading four card headings to rule them out.
 *
 * **The rows are in the order the scorer cares about them**, and that came from the screen
 * being wrong rather than merely untidy. Education and experience used to sit last under a
 * heading reading "Kept on file, not used for matching yet". That stopped being true at scorer
 * v3 (20261024000000_match_score_v3.sql) — work now carries the field, and between them
 * experience and field are nearly half a match — so the screen was filing most of a reader's
 * score under "not used" at the bottom of a scroll.
 *
 * So: skills, work, school, level. No weights are printed. An earlier pass put each one's
 * percentage on it, read out of the migration, which is arithmetic nobody asked for and a copy
 * of a number that lives somewhere else: a v4 reweighting would have left confident wrong
 * figures here with nothing to catch them. The order says the same thing and cannot rot.
 *
 * WHERE sits last and says what it does. v3 dropped location from the match — "experience
 * replaces location" — but the feed ranker still reads it, so it is neither scored nor inert.
 *
 * ── Adding a skill, and what it reaches ───────────────────────────────────────
 *
 * Skills can be taken off this list and put back on it. The adding is what §3.9's ~15% is
 * about: a parser reading a two-column PDF drops skills the page plainly shows, and without a
 * way back the only remedy is editing the document and uploading it again.
 *
 * Worth knowing where the list goes, because it is further than the match score.
 * `server/src/autoapply.ts` selects it alongside education and experience, and the drafting
 * prompt tells the model to write answers "only from the facts provided — their actual
 * experience and skills". So a skill typed here can become a sentence in an application sent
 * in the reader's name, against a resume that does not mention it.
 *
 * Hence the placeholder: "One we missed", not "Add a skill". The field is for recovering what
 * the page already says, and the copy is the only thing standing between that and a wish list.
 *
 * ── Gaps where they can be filled ─────────────────────────────────────────────
 *
 * An empty control and a correctly-empty control look identical in a form, so a blank says
 * nothing about whether the parser missed something or the page never had it. Each row that is
 * empty says so in its own body — "Not stated on the page — pick one" sits above the level
 * chips, one tap from the fix, where the same sentence in a banner at the top would be a hunt.
 */

const SENIORITY_OPTIONS: { value: ResumeSeniority; label: string }[] = [
  { value: 'intern', label: 'Intern' },
  { value: 'new_grad', label: 'New grad' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'staff_plus', label: 'Staff+' },
];

// Named the way app/paywall.tsx does, and for the same reason: reanimated does not export the
// type of its own `entering` prop.
type EnteringAnimation = ComponentProps<typeof Animated.View>['entering'];

export default function ResumeReviewScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const { userId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const reduced = useReducedMotion();
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

  /*
   * Slugged the way the parser writes them, so an added skill and a read one are the same kind
   * of string: lower case, spaces to hyphens, and the punctuation a language name actually uses
   * (c++, c#, node.js) kept.
   */
  const addSkill = () => {
    const slug = draftSkill
      .toLowerCase()
      .trim()
      // The hyphen leads the class so it is a literal, not a range — and the characters kept
      // are the ones language names actually use: c++, c#, node.js, rest-apis.
      .replace(/[^-a-z0-9+#. ]/g, '')
      .replace(/ +/g, '-');
    if (slug.length < 2 || shownSkills.includes(slug)) {
      setDraftSkill('');
      return;
    }
    setSkills([...shownSkills, slug]);
    setDraftSkill('');
  };

  const canConfirm = resume?.parseStatus === 'parsed' && !isBusy;

  /*
   * The same entrance the paywall and the verification screen use: the heading lands, then the
   * file, then the rows in reading order. On a screen that is mostly hairlines this is what
   * stops it arriving as a wall of rules, and it tells the eye which way to travel down it.
   */
  const enter = (delay: number): EnteringAnimation =>
    reduced
      ? FadeIn.duration(180)
      : FadeInDown.duration(440).delay(delay).springify().dampingRatio(0.88);

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
      {/*
        A grabber instead of a close button.

        This route is `presentation: 'modal'` (app/_layout.tsx), so on iOS the sheet already
        drags down to dismiss — the × was a second control for something the gesture did, taking
        the top-left corner to say it. The grabber is the affordance that gesture never had.

        It is also a Pressable, so it is not an affordance for a gesture that does not exist
        everywhere: Android's modal presentation has no drag, and a tap closes on both. The
        same two-jobs-one-mark the GIF sheet's grabber does.
      */}
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.grabberZone}>
        <View style={styles.grabber} />
      </Pressable>
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
            {/*
              Which document this is, on its own line rather than inside a sentence.
              It was set in the opening paragraph, where a file name is something you read past
              — and on a shelf of three near-identical resumes the only question this screen has
              to answer before any other is which one you opened.

              Still, and clipped in the middle when it is too long. The shelf and the viewer let
              this name travel, which suits a tile you glance at; here it sits above everything
              else you are reading, and a line that moves on its own is the thing the eye keeps
              going back to. Middle truncation keeps the useful halves — "Resume_v2 (1).pdf"
              loses its centre rather than its tail, so two near-identical files still read apart.
            */}
            <Animated.View entering={enter(60)} style={styles.fileRow}>
              <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
                  {resume.name}
                </Text>
                {pageCount !== null ? (
                  <Text style={styles.fileMeta}>
                    {pageCount} {pageCount === 1 ? 'page' : 'pages'} read
                  </Text>
                ) : null}
              </View>
            </Animated.View>

            <Animated.Text entering={enter(110)} style={styles.lede}>
              Fix anything wrong — the file itself is never edited.
            </Animated.Text>

            <View style={styles.rows}>
              {/* ── Skills ─────────────────────────────────────────────── */}
              <Animated.View entering={enter(170)} style={styles.row}>
                <Text style={styles.rowLabel}>SKILLS</Text>
                <View style={styles.rowBody}>
                  {shownSkills.length > 0 ? (
                    <View style={styles.chips}>
                      {shownSkills.map((skill) => (
                        <Pressable
                          key={skill}
                          onPress={() => setSkills(shownSkills.filter((entry) => entry !== skill))}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${skill}`}
                          // Drawn at 28, hit at 44: the row stays quiet, the target does not shrink.
                          hitSlop={8}
                          style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}>
                          <Text style={styles.chipLabel}>{skill}</Text>
                          {/*
                            An explicit ×. Tapping a chip to delete it is the interaction either
                            way, but without the glyph nothing on screen says so, and a chip that
                            silently vanishes when touched reads as a bug.
                          */}
                          <Ionicons name="close" size={11} color={colors.textTertiary} />
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.prompt}>None were read from the page.</Text>
                  )}

                  {/*
                    Adding, for the ones the parser dropped.

                    Worth knowing what this list feeds: it is matched against postings, and
                    Auto Apply writes its answers from it (server/src/autoapply.ts) — so a skill
                    typed here can end up in an application sent in the reader's name. The
                    placeholder says "missed" rather than "add" for that reason: the useful case
                    is a skill the document already shows and the parser did not catch.
                  */}
                  <View style={styles.addRow}>
                    <Ionicons name="add" size={15} color={colors.textTertiary} />
                    <TextInput
                      value={draftSkill}
                      onChangeText={setDraftSkill}
                      onSubmitEditing={addSkill}
                      placeholder="One we missed"
                      placeholderTextColor={colors.textTertiary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      style={styles.addInput}
                      accessibilityLabel="Add a skill the parser missed"
                    />
                  </View>
                </View>
              </Animated.View>

              {/* ── Work ───────────────────────────────────────────────── */}
              <Animated.View entering={enter(230)} style={styles.row}>
                <Text style={styles.rowLabel}>WORK</Text>
                <View style={styles.rowBody}>
                  {experience.length > 0 ? (
                    experience.map((entry, index) => (
                      <View key={`exp-${index}`} style={index > 0 ? styles.entryNext : undefined}>
                        <Text style={styles.entryTitle}>{entry.title ?? 'Role'}</Text>
                        <Text style={styles.entryMeta}>
                          {[entry.company, entry.isCurrent ? 'current' : null]
                            .filter(Boolean)
                            .join(' · ') || 'Company not read'}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.prompt}>No roles were read from the page.</Text>
                  )}
                  {years !== null ? (
                    <Text style={styles.entryMeta}>
                      {years} {years === 1 ? 'year' : 'years'} in total, from the dates on the page.
                    </Text>
                  ) : null}
                </View>
              </Animated.View>

              {/* ── School ─────────────────────────────────────────────── */}
              <Animated.View entering={enter(290)} style={styles.row}>
                <Text style={styles.rowLabel}>SCHOOL</Text>
                <View style={styles.rowBody}>
                  {education.length > 0 ? (
                    education.map((entry, index) => (
                      <View key={`edu-${index}`} style={index > 0 ? styles.entryNext : undefined}>
                        <Text style={styles.entryTitle}>
                          {[entry.degree, entry.field].filter(Boolean).join(', ') || 'Education'}
                        </Text>
                        <Text style={styles.entryMeta}>
                          {[entry.school, entry.graduationYear].filter(Boolean).join(' · ') ||
                            'School not read'}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.prompt}>Nothing was read from the page.</Text>
                  )}
                </View>
              </Animated.View>

              {/* ── Level ──────────────────────────────────────────────── */}
              <Animated.View entering={enter(350)} style={styles.row}>
                <Text style={styles.rowLabel}>LEVEL</Text>
                <View style={styles.rowBody}>
                  {/*
                    The prompt sits in the row rather than in a banner at the top of the screen.
                    A resume rarely states a level outright, so this is the blank that is almost
                    always there — and a gap named where it can be filled is one tap, where the
                    same gap named in a summary above is a hunt.
                  */}
                  {shownSeniority === null ? (
                    <Text style={styles.prompt}>Not stated on the page — pick one.</Text>
                  ) : null}
                  <View style={styles.chips}>
                    {SENIORITY_OPTIONS.map((option) => {
                      const selected = shownSeniority === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setSeniority(selected ? null : option.value)}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          // 30 drawn + 7 each side = the 44pt floor, same trick as the skills.
                          hitSlop={7}
                          style={[styles.option, selected ? styles.optionSelected : null]}>
                          <Text
                            style={[
                              styles.optionLabel,
                              selected ? styles.optionLabelSelected : null,
                            ]}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </Animated.View>

              {/* ── Where ──────────────────────────────────────────────── */}
              <Animated.View entering={enter(410)} style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>WHERE</Text>
                <View style={styles.rowBody}>
                  {/*
                    Borderless on purpose: everything else in this column is text, and a boxed
                    field here would be the only control on the screen shouting that it is one.
                    It still behaves as an input — tapping the line puts a caret in it.
                  */}
                  <TextInput
                    value={shownLocation}
                    onChangeText={setLocation}
                    placeholder="Add a city"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.locationInput}
                    accessibilityLabel="Your location"
                  />
                  <Text style={styles.entryMeta}>
                    Sets what reaches your feed, not your score.
                  </Text>
                </View>
              </Animated.View>
            </View>

            {/*
             * The contact fields, named and not shown. The user cannot otherwise tell whether
             * the extractor found an email — and that is the only part worth telling them,
             * because the value itself is already theirs. PHASE4.md §4.4.
             */}
            <View style={styles.sealed}>
              <Ionicons name="lock-closed" size={13} color={colors.textTertiary} />
              <Text style={styles.sealedText}>
                Name, email and phone were read and encrypted. Never shown back in the app.
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
  // The same measurements as the comment sheet's, so the two read as one gesture.
  grabberZone: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  // Larger than it was: with the heading gone this line is what the screen opens on, and it is
  // also the answer to the first question anybody has here — which of my resumes is this.
  fileName: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  fileMeta: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    marginTop: 1,
  },
  lede: {
    marginTop: spacing.md,
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textSecondary,
  },

  /*
   * The rows.
   *
   * A label column and a content column, divided by hairlines and nothing else — no cards, no
   * fills, no headings competing with the page's one title. The label is what makes it scan:
   * the eye runs down a single narrow column of six words to find the thing it came for,
   * instead of reading four card headings at body size to rule them out.
   */
  rows: {
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    width: 68,
    paddingTop: 2,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    // textSecondary, not tertiary: at 11px the lighter grey is 3.2:1, and this column is the
    // one thing on the screen that has to be readable at a glance.
    color: colors.textSecondary,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },

  entryTitle: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 19,
  },
  entryMeta: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    lineHeight: 17,
  },
  entryNext: {
    marginTop: spacing.sm,
  },
  /** A blank the reader can do something about, said where they can do it. */
  prompt: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 17,
  },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    paddingLeft: 9,
    paddingRight: 7,
    borderRadius: radius.md - 6,
    backgroundColor: colors.backgroundMuted,
  },
  chipPressed: {
    opacity: 0.6,
  },
  chipLabel: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },

  option: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: radius.md - 6,
    backgroundColor: colors.backgroundMuted,
  },
  // Fill alone marks the choice — no border appears or thickens, so nothing shifts by a pixel.
  optionSelected: {
    backgroundColor: colors.accent,
  },
  optionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  optionLabelSelected: {
    color: colors.accentText,
    fontWeight: '600',
  },

  // Deliberately the quietest thing in the row: a line to type on, not a box demanding filling.
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  addInput: {
    flex: 1,
    minHeight: 32,
    paddingVertical: spacing.xs,
    paddingHorizontal: 0,
    fontSize: fontSize.caption,
    color: colors.text,
  },
  locationInput: {
    minHeight: 34,
    paddingVertical: spacing.xs,
    paddingHorizontal: 0,
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.text,
  },

  sealed: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sealedText: {
    flex: 1,
    fontSize: fontSize.caption,
    lineHeight: 17,
    color: colors.textTertiary,
  },

  // ── states around the parse ────────────────────────────────────────────────
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
  },
  noticeBad: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.md,
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
  body: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  hint: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    lineHeight: 17,
  },

  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  error: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.danger,
  },
}));
