import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, Svg } from 'react-native-svg';

import { FullDetails, FullHero } from '@/components/reels/MatchBreakdownFull';
import { MATCH_COLOR_STOPS } from '@/components/reels/ResumeMatchRing';
import { FREE_MATCH_LOOKS } from '@/constants/limits';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { claimMatchLook, fetchMatchLook, type MatchLook } from '@/lib/api';
import {
  breakdown,
  capLine,
  eligibilityRows,
  FAMILY_LABELS,
  fieldLine,
  levelLine,
  MATCH_CEILING,
  MATCH_PART_LABELS,
  matchTier,
  skillsLine,
  suggestions,
  TIER_LABELS,
  type Breakdown,
} from '@/lib/matchScore';
import type { Job, MatchScore, Resume } from '@/types';
import { weekKey } from '@/utils/week';

interface MatchExplainSheetProps {
  job: Job;
  match: MatchScore;
  /** The default resume the score was computed against: its roles are named in the sheet. */
  resume: Resume | undefined;
  onClose: () => void;
  /** Free readers: close this and open the paywall. */
  onUpgrade: () => void;
  /** Close this and open Profile, where the eligibility answers live. */
  onOpenProfile: () => void;
}

const SHEET_MAX_RATIO = 0.9;
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 800;
const OPEN = { duration: 300, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 200, easing: Easing.in(Easing.cubic) };

const RING = 112;
const RING_STROKE = 9;
const RING_RADIUS = (RING - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** How much of the locked details shows through the blur: enough to see what is there, not read it. */
const LOCKED_PEEK = 220;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const ELIGIBILITY_CAPS = new Set<string>(['sponsorship', 'sponsorship_soft', 'citizenship', 'graduation']);

const LEVEL_LABELS: Record<string, string> = {
  intern: 'Internship',
  new_grad: 'New grad',
  mid: 'Mid-level',
  senior: 'Senior',
  staff_plus: 'Staff+',
};

/** One score, one colour: the same stops the ring on the reel uses. */
const scoreColor = (score: number) => interpolateColor(score, MATCH_COLOR_STOPS.input, MATCH_COLOR_STOPS.output);

const lookKey = (jobId: string, week: string) => ['match-look', jobId, week] as const;

/**
 * Why the ring says what it says.
 *
 * Open (Pro, or a free reader who spent one of the week's three looks on this posting): the full
 * breakdown in MatchBreakdownFull.tsx, unchanged.
 *
 * Locked (a free reader who hasn't): the score and how it adds up, readable; the rest blurred
 * beneath, with the offer below it (20261025000000_match_free_looks.sql). This locked view is
 * kept plain on purpose: sections divided by hairlines rather than boxed, no icons on headings,
 * and nothing animates in except the ring drawing to its number.
 *
 * Mounted only while open (the caller keys it on the job): it slides itself in on mount, and out
 * again before calling `onClose`.
 */
export function MatchExplainSheet({ job, match, resume, onClose, onUpgrade, onOpenProfile }: MatchExplainSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const { credits } = useCareerDeck();
  const queryClient = useQueryClient();

  const maxHeight = windowHeight * SHEET_MAX_RATIO;
  const translateY = useSharedValue(maxHeight);
  const scrollY = useSharedValue(0);

  useEffect(() => {
    translateY.set(withTiming(0, OPEN));
  }, [translateY]);

  /** Slides the sheet away, then runs `after` — closing, or going somewhere else. */
  const leave = (after: () => void) => {
    translateY.set(
      withTiming(maxHeight, CLOSE, (finished) => {
        'worklet';
        if (finished) runOnJS(after)();
      }),
    );
  };

  // The week's free looks. Pro never asks: everything is open.
  const week = weekKey(new Date());
  const look = useQuery({
    queryKey: lookKey(job.id, week),
    queryFn: () => fetchMatchLook(job.id, week),
    enabled: !credits.isPro,
    staleTime: 30_000,
  });
  const claim = useMutation({
    mutationFn: () => claimMatchLook(job.id, week),
    onSuccess: (result) => queryClient.setQueryData<MatchLook>(lookKey(job.id, week), result),
  });
  const open = credits.isPro || look.data?.open === true;

  // A posting the reader can't take says so to everyone, Pro or not: that is not an upsell.
  const cap = match.components.cap;
  const blocking = cap && ELIGIBILITY_CAPS.has(cap.reason) ? capLine(cap.reason, cap.at, match.components.jobFamily) : null;

  // The scroll view's own pan, recognised alongside the sheet's so neither cancels the other.
  const scrollGesture = Gesture.Native();
  // Claims downward drags only while the content is scrolled to the top.
  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetY(-8)
    .simultaneousWithExternalGesture(scrollGesture)
    .onUpdate((event) => {
      'worklet';
      if (scrollY.value <= 0) translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      'worklet';
      if (translateY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        translateY.set(
          withTiming(maxHeight, CLOSE, (finished) => {
            'worklet';
            if (finished) runOnJS(onClose)();
          }),
        );
      } else {
        translateY.set(withTiming(0, OPEN));
      }
    });

  const onScroll = useAnimatedScrollHandler((event) => {
    'worklet';
    scrollY.set(event.contentOffset.y);
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  // The backdrop fades with the sheet's travel instead of sliding up with it.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, maxHeight], [1, 0]),
  }));

  const parts = useMemo(() => breakdown(match), [match]);

  return (
    <Modal visible animationType="none" transparent onRequestClose={() => leave(onClose)} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={styles.fill} onPress={() => leave(onClose)} accessibilityLabel="Close match details" />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.sheet, { maxHeight }, sheetStyle]}>
          <View style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>

          <GestureDetector gesture={scrollGesture}>
            <Animated.ScrollView
              onScroll={onScroll}
              scrollEventThrottle={16}
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
              {open ? (
                // Open (Pro, or a free look spent): the full breakdown exactly as it was.
                <>
                  <FullHero
                    job={job}
                    score={match.score}
                    tier={matchTier(match.score)}
                    reduced={reduced}
                    warning={blocking}
                    onClose={() => leave(onClose)}
                  />
                  <FullDetails
                    job={job}
                    match={match}
                    parts={parts}
                    resume={resume}
                    reduced={reduced}
                    onOpenProfile={() => leave(onOpenProfile)}
                  />
                </>
              ) : (
                <>
                  <Hero job={job} score={match.score} reduced={reduced} warning={blocking} />
                  <AddsUp parts={parts} jobFamily={match.components.jobFamily} />
                  <Locked>
                    <Details job={job} match={match} resume={resume} onOpenProfile={() => undefined} />
                  </Locked>
                  <Unlock
                    look={look.data}
                    failed={look.isError}
                    claiming={claim.isPending}
                    claimFailed={claim.isError}
                    onUseLook={() => claim.mutate()}
                    onUpgrade={() => leave(onUpgrade)}
                  />
                </>
              )}

            </Animated.ScrollView>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </Modal>
  );
}

// ── the open part ────────────────────────────────────────────────────────────────

function Hero({ job, score, reduced, warning }: { job: Job; score: number; reduced: boolean; warning: string | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tier = matchTier(score);

  // Draws from 0 to the score once, with the number counting alongside it.
  const progress = useSharedValue(reduced ? score : 0);
  useEffect(() => {
    if (!reduced) progress.set(withDelay(120, withTiming(score, { duration: 800, easing: Easing.out(Easing.cubic) })));
  }, [progress, score, reduced]);

  const [label, setLabel] = useState(reduced ? score : 0);
  useAnimatedReaction(
    () => Math.round(progress.value),
    (current, previous) => {
      if (current !== previous) runOnJS(setLabel)(current);
    },
    [],
  );

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress.value / 100),
    stroke: interpolateColor(progress.value, MATCH_COLOR_STOPS.input, MATCH_COLOR_STOPS.output),
  }));

  return (
    <View style={styles.hero}>
      <View
        style={styles.ring}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${score} percent match. ${TIER_LABELS[tier]}.`}>
        <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
          <Circle cx={RING / 2} cy={RING / 2} r={RING_RADIUS} stroke={colors.backgroundMuted} strokeWidth={RING_STROKE} fill="none" />
          <AnimatedCircle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_RADIUS}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${RING_CIRCUMFERENCE}, ${RING_CIRCUMFERENCE}`}
            rotation={-90}
            origin={`${RING / 2}, ${RING / 2}`}
            animatedProps={ringProps}
          />
        </Svg>
        <Text style={styles.ringScore}>
          {label}
          <Text style={styles.ringPercent}>%</Text>
        </Text>
      </View>

      <View style={styles.heroText}>
        <Text style={[styles.tier, { color: scoreColor(score) }]}>{TIER_LABELS[tier]}</Text>
        <Text style={styles.heroJob} numberOfLines={2}>
          {job.title}
        </Text>
        <Text style={styles.heroCompany} numberOfLines={1}>
          {job.companyName}
        </Text>
      </View>

      {warning ? (
        <View style={styles.warning}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.warningText}>{warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The score as points: one bar per part, then what the ceiling and a cap took off. */
function AddsUp({ parts, jobFamily }: { parts: Breakdown; jobFamily?: string }) {
  const styles = useStyles();
  const final = parts.raw - parts.ceilingCut - parts.capCut;

  return (
    <Section title="How it adds up" first>
      {parts.rows.map((row) => (
        <View
          key={row.part}
          style={styles.partRow}
          accessible
          accessibilityLabel={`${MATCH_PART_LABELS[row.part]}: ${row.points} of ${row.max} points`}>
          <View style={styles.partHead}>
            <Text style={styles.partLabel}>{MATCH_PART_LABELS[row.part]}</Text>
            <Text style={styles.partPoints}>
              {row.points}
              <Text style={styles.partMax}> / {row.max}</Text>
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${row.max > 0 ? Math.min(100, (row.points / row.max) * 100) : 0}%` }]} />
          </View>
        </View>
      ))}

      {parts.ceilingCut > 0 ? (
        <Deduction label="Ceiling" points={parts.ceilingCut} line={`No match is perfect, so scores stop at ${MATCH_CEILING}.`} />
      ) : null}
      {parts.capCut > 0 && parts.cap ? (
        <Deduction label="Cap" points={parts.capCut} line={capLine(parts.cap.reason, parts.cap.at, jobFamily)} />
      ) : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Match</Text>
        <Text style={styles.totalValue}>{final}</Text>
      </View>

      {parts.skipped.length > 0 ? (
        <Text style={styles.small}>
          {listParts(parts.skipped.map((p) => MATCH_PART_LABELS[p]))} couldn&apos;t be judged for this posting, so the
          others were reweighted to fill 100.
        </Text>
      ) : null}
    </Section>
  );
}

function Deduction({ label, points, line }: { label: string; points: number; line: string }) {
  const styles = useStyles();
  return (
    <View style={styles.deduction}>
      <View style={styles.partHead}>
        <Text style={styles.partLabel}>{label}</Text>
        <Text style={styles.deductionPoints}>−{points}</Text>
      </View>
      <Text style={styles.small}>{line}</Text>
    </View>
  );
}

// ── the Pro part ─────────────────────────────────────────────────────────────────

function Details({
  job,
  match,
  resume,
  onOpenProfile,
}: {
  job: Job;
  match: MatchScore;
  resume: Resume | undefined;
  onOpenProfile: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const c = match.components;
  const ideas = useMemo(() => suggestions(match), [match]);
  const eligibility = useMemo(() => eligibilityRows(match), [match]);
  const family = c.jobFamily ? FAMILY_LABELS[c.jobFamily] : undefined;

  // Matched before missing within each group, as the scorer ordered them.
  const niceSet = new Set(c.preferred);
  const all = [...c.matched, ...c.missing];
  const required = all.filter((skill) => !niceSet.has(skill));
  const nice = all.filter((skill) => niceSet.has(skill));

  return (
    <>
      <Section title="Skills">
        <Text style={styles.body}>{skillsLine(match)}</Text>
        {required.length > 0 ? (
          <SkillGroup title={nice.length > 0 ? 'Required' : undefined} skills={required} match={match} />
        ) : null}
        {nice.length > 0 ? <SkillGroup title="Nice to have" skills={nice} match={match} /> : null}
        {c.fromWork.length > 0 ? (
          <Text style={styles.small}>
            <Ionicons name="briefcase-outline" size={12} color={colors.textTertiary} /> came from a role or project on
            your resume rather than its skills list.
          </Text>
        ) : null}
      </Section>

      {eligibility.length > 0 ? (
        <Section title="Eligibility">
          {eligibility.map((row) => (
            <Row
              key={row.id}
              icon={
                row.status === 'ok' ? 'checkmark-circle'
                  : row.status === 'blocked' ? 'close-circle'
                    : row.status === 'ask' ? 'help-circle-outline' : 'information-circle-outline'
              }
              tone={row.status === 'blocked' ? 'bad' : row.status === 'ok' ? 'good' : 'muted'}
              title={row.title}
              line={row.line}
            />
          ))}
          {eligibility.some((row) => row.status === 'ask') ? (
            <Pressable
              onPress={onOpenProfile}
              style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null]}
              accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>Answer in Profile</Text>
            </Pressable>
          ) : null}
        </Section>
      ) : null}

      {typeof c.experience === 'number' ? (
        <Section title="Experience">
          {c.roles.length > 0 ? (
            c.roles.map((role) => {
              const entry = resume?.profile.experience[role.index];
              return (
                <View key={role.index} style={styles.textBlock}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {entry?.title ?? 'A past role'}
                    {entry?.company ? <Text style={styles.rowTitleMuted}> · {entry.company}</Text> : null}
                  </Text>
                  <Text style={styles.small}>
                    {role.relevance >= 0.99 ? 'Same field' : `Related field: ${FAMILY_LABELS[role.family] ?? role.family}`}
                    {role.months ? ` · ${role.months} months` : ''}
                  </Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.body}>
              Nothing on your resume is in {family ?? 'this field'} yet. A past role counts when its title is in the same
              field as the job, or a neighbouring one.
            </Text>
          )}
        </Section>
      ) : null}

      {typeof c.field === 'number' || typeof c.seniority === 'number' ? (
        <Section title="Field and level">
          {typeof c.field === 'number' ? (
            <Row
              icon={c.field >= 0.5 ? 'checkmark-circle' : 'remove-circle-outline'}
              tone={c.field >= 0.5 ? 'good' : 'muted'}
              title={family ?? 'This role'}
              line={fieldLine(c.field, c.fieldSource)}
            />
          ) : null}
          {typeof c.seniority === 'number' ? (
            <Row
              icon={c.seniority >= 0.6 ? 'checkmark-circle' : 'remove-circle-outline'}
              tone={c.seniority >= 0.6 ? 'good' : 'muted'}
              title={LEVEL_LABELS[job.seniority ?? ''] ?? 'Level unlisted'}
              line={levelLine(c.seniority)}
            />
          ) : null}
        </Section>
      ) : null}

      <Section title="What would raise it">
        {ideas.length > 0 ? (
          ideas.map((idea) => (
            <View key={idea.id} style={styles.idea}>
              <View style={styles.textBlock}>
                <Text style={styles.rowTitle}>{idea.title}</Text>
                <Text style={styles.small}>{idea.body}</Text>
              </View>
              <Text style={styles.gain}>+{idea.gain}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.body}>Nothing big. This is about as high as this posting goes for you.</Text>
        )}
      </Section>
    </>
  );
}

// ── free readers ─────────────────────────────────────────────────────────────────

/**
 * The details, cut to a peek and blurred: enough to see that there are skills, roles and a list of
 * changes, not enough to read them. Hidden from screen readers, which would read through the blur.
 */
function Locked({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const { scheme } = useTheme();
  return (
    <View style={styles.locked}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
        {children}
      </View>
      <BlurView
        intensity={scheme === 'dark' ? 45 : 32}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        blurMethod="dimezisBlurViewSdk31Plus"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function Unlock({
  look,
  failed,
  claiming,
  claimFailed,
  onUseLook,
  onUpgrade,
}: {
  look: MatchLook | undefined;
  failed: boolean;
  claiming: boolean;
  claimFailed: boolean;
  onUseLook: () => void;
  onUpgrade: () => void;
}) {
  const styles = useStyles();
  const limit = look?.limit ?? FREE_MATCH_LOOKS;
  const left = look ? Math.max(0, limit - look.used) : null;
  const outOfLooks = left === 0;

  let title: string;
  let line: string;
  if (failed || left === null) {
    title = 'Skills, experience and what would raise this';
    line = failed ? 'We couldn’t check your free looks just now.' : `Free accounts can open ${limit} a week.`;
  } else if (outOfLooks) {
    title = 'No free looks left this week';
    line = `You get ${limit} more on Monday. Pro opens every posting.`;
  } else {
    title = `${left} free ${left === 1 ? 'look' : 'looks'} left this week`;
    line = 'Open the skills you’re missing, your relevant experience and what would raise this score.';
  }

  return (
    <View style={styles.unlock}>
      <Text style={styles.unlockTitle}>{title}</Text>
      <Text style={styles.small}>{line}</Text>
      {claimFailed ? <Text style={styles.error}>That didn’t go through. Try again.</Text> : null}

      {left !== null && !outOfLooks ? (
        <Pressable
          onPress={onUseLook}
          disabled={claiming}
          style={({ pressed }) => [styles.primaryButton, pressed || claiming ? styles.pressed : null]}
          accessibilityRole="button"
          accessibilityState={{ busy: claiming }}>
          <Text style={styles.primaryButtonText}>{claiming ? 'Opening…' : 'Use a free look'}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onUpgrade}
        style={({ pressed }) => [
          outOfLooks || left === null ? styles.primaryButton : styles.textButton,
          pressed ? styles.pressed : null,
        ]}
        accessibilityRole="button">
        <Text style={outOfLooks || left === null ? styles.primaryButtonText : styles.textButtonText}>
          Get Pro for every posting
        </Text>
      </Pressable>
    </View>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────────

function Section({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={[styles.section, first ? null : styles.sectionDivided]}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({
  icon,
  tone,
  title,
  line,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'good' | 'bad' | 'muted';
  title: string;
  line: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = tone === 'bad' ? colors.danger : tone === 'good' ? colors.text : colors.textTertiary;
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.textBlock}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.small}>{line}</Text>
      </View>
    </View>
  );
}

function SkillGroup({ title, skills, match }: { title?: string; skills: string[]; match: MatchScore }) {
  const styles = useStyles();
  const have = new Set(match.components.matched);
  const fromWork = new Set(match.components.fromWork);
  return (
    <View style={styles.skillGroup}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={styles.chips}>
        {skills.map((skill) => (
          <Chip key={skill} label={skill} have={have.has(skill)} fromWork={fromWork.has(skill)} />
        ))}
      </View>
    </View>
  );
}

function Chip({ label, have, fromWork }: { label: string; have: boolean; fromWork: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View
      style={[styles.chip, have ? styles.chipHave : styles.chipMissing]}
      accessibilityLabel={
        have ? `${label}, on your resume${fromWork ? ' from a role or project' : ''}` : `${label}, not on your resume`
      }>
      {have ? <Ionicons name={fromWork ? 'briefcase-outline' : 'checkmark'} size={13} color={colors.text} /> : null}
      <Text style={have ? styles.chipLabel : styles.chipLabelMuted}>{label}</Text>
    </View>
  );
}

function listParts(names: string[]): string {
  return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
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
    paddingHorizontal: screenPadding,
  },
  pressed: { opacity: 0.6 },

  // Hero: ring on the left, what it means on the right.
  hero: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  ring: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  ringScore: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  ringPercent: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  heroText: {
    alignItems: 'center',
    gap: 2,
  },
  tier: {
    fontSize: fontSize.small,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  heroJob: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  heroCompany: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.text,
  },

  // Sections: divided by a hairline, not boxed.
  section: {
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  sectionDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sectionTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  small: {
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  partRow: { gap: 6 },
  partHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  partLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  partPoints: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  partMax: {
    fontWeight: '400',
    color: colors.textTertiary,
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.text,
  },
  deduction: { gap: 2 },
  deductionPoints: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  totalValue: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  skillGroup: { gap: spacing.sm },
  groupTitle: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipHave: {
    backgroundColor: colors.backgroundMuted,
    borderColor: colors.backgroundMuted,
  },
  chipMissing: {
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  chipLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  chipLabelMuted: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },

  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  textBlock: { flex: 1, gap: 2 },
  rowTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  rowTitleMuted: {
    fontWeight: '400',
    color: colors.textSecondary,
  },
  idea: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  gain: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  secondaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  secondaryButtonText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },

  locked: {
    height: LOCKED_PEEK,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  unlock: {
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  unlockTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
  },
  error: {
    fontSize: fontSize.small,
    color: colors.danger,
  },
  primaryButton: {
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.accentText,
  },
  textButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  textButtonText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },

  footnote: {
    paddingTop: spacing.md,
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textTertiary,
  },
}));
