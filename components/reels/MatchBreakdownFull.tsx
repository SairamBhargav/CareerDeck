import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { MATCH_COLOR_STOPS } from '@/components/reels/ResumeMatchRing';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import {
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
  tierLine,
  type Breakdown,
  type MatchPart,
  type Suggestion,
} from '@/lib/matchScore';
import type { Job, MatchScore, Resume } from '@/types';


const HERO_RING = 128;
const HERO_STROKE = 10;
const HERO_RADIUS = (HERO_RING - HERO_STROKE) / 2;
const HERO_CIRCUMFERENCE = 2 * Math.PI * HERO_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);


/** One score, one colour: the same stops the ring on the reel uses. */
const scoreColor = (score: number) => interpolateColor(score, MATCH_COLOR_STOPS.input, MATCH_COLOR_STOPS.output);

// ── hero ─────────────────────────────────────────────────────────────────────────

/**
 * The full breakdown, as it looked before free looks existed: what a Pro reader sees, and what a
 * free reader sees after spending a look. MatchExplainSheet owns the sheet around it and the
 * locked view free readers see first. Kept as it was on purpose (the owner's call, 2026-10-08).
 */
export function FullHero({
  job,
  score,
  tier,
  reduced,
  warning,
  onClose,
}: {
  job: Job;
  score: number;
  tier: ReturnType<typeof matchTier>;
  reduced: boolean;
  warning: string | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tint = scoreColor(score);

  // Draws from 0 to the score once, with the number counting alongside it.
  const progress = useSharedValue(reduced ? score : 0);
  useEffect(() => {
    if (!reduced) progress.set(withDelay(120, withTiming(score, { duration: 900, easing: Easing.out(Easing.cubic) })));
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
    strokeDashoffset: HERO_CIRCUMFERENCE * (1 - progress.value / 100),
    stroke: interpolateColor(progress.value, MATCH_COLOR_STOPS.input, MATCH_COLOR_STOPS.output),
  }));

  return (
    <View style={styles.hero}>
      <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </Pressable>

      <View
        style={styles.heroRing}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${score} percent match. ${TIER_LABELS[tier]}.`}>
        <Svg width={HERO_RING} height={HERO_RING} style={{ position: 'absolute' }}>
          <Circle
            cx={HERO_RING / 2}
            cy={HERO_RING / 2}
            r={HERO_RADIUS}
            stroke={colors.backgroundMuted}
            strokeWidth={HERO_STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={HERO_RING / 2}
            cy={HERO_RING / 2}
            r={HERO_RADIUS}
            strokeWidth={HERO_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${HERO_CIRCUMFERENCE}, ${HERO_CIRCUMFERENCE}`}
            rotation={-90}
            origin={`${HERO_RING / 2}, ${HERO_RING / 2}`}
            animatedProps={ringProps}
          />
        </Svg>
        <Text style={styles.heroScore}>
          {label}
          <Text style={styles.heroPercent}>%</Text>
        </Text>
        <Text style={styles.heroCaption}>MATCH</Text>
      </View>

      <View style={styles.tierPill}>
        <View style={[styles.tierWash, { backgroundColor: tint }]} />
        <View style={[styles.tierDot, { backgroundColor: tint }]} />
        <Text style={styles.tierLabel}>{TIER_LABELS[tier]}</Text>
      </View>

      <Text style={styles.heroJob} numberOfLines={2}>
        {job.title} · {job.companyName}
      </Text>
      <Text style={styles.heroLine}>{tierLine(tier)}</Text>
      {warning ? (
        <View style={styles.heroWarning}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.heroWarningText}>{warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Pro ──────────────────────────────────────────────────────────────────────────

export function FullDetails({
  job,
  match,
  parts,
  resume,
  reduced,
  onOpenProfile,
}: {
  job: Job;
  match: MatchScore;
  parts: Breakdown;
  resume: Resume | undefined;
  reduced: boolean;
  onOpenProfile: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const c = match.components;
  const ideas = useMemo(() => suggestions(match), [match]);
  const eligibility = useMemo(() => eligibilityRows(match), [match]);
  // Matched before missing within each group, as the scorer ordered them.
  const niceSet = new Set(c.preferred);
  const all = [...c.matched, ...c.missing];
  const required = all.filter((skill) => !niceSet.has(skill));
  const nice = all.filter((skill) => niceSet.has(skill));
  const family = c.jobFamily ? FAMILY_LABELS[c.jobFamily] : undefined;
  const enter = (i: number) => (reduced ? undefined : FadeInDown.duration(380).delay(200 + i * 70));

  return (
    <>
      <Animated.View entering={enter(0)}>
        <AddsUp parts={parts} jobFamily={c.jobFamily} reduced={reduced} />
      </Animated.View>

      <Animated.View entering={enter(1)}>
        <Section icon="construct-outline" title="Skills">
          <Text style={styles.body}>{skillsLine(match)}</Text>
          {required.length > 0 ? (
            <SkillGroup title={nice.length > 0 ? 'Required' : undefined} skills={required} match={match} />
          ) : null}
          {nice.length > 0 ? <SkillGroup title="Nice to have" skills={nice} match={match} /> : null}
          {c.fromWork.length > 0 ? (
            <View style={styles.legend}>
              <Ionicons name="briefcase-outline" size={12} color={colors.textTertiary} />
              <Text style={styles.legendText}>From a role or project on your resume, not its skills list</Text>
            </View>
          ) : null}
        </Section>
      </Animated.View>

      {eligibility.length > 0 ? (
        <Animated.View entering={enter(1.5)}>
          <Section icon="shield-checkmark-outline" title="Eligibility">
            {eligibility.map((row) => (
              <View key={row.id} style={styles.verdict}>
                <Mark kind={row.status === 'ok' ? 'ok' : row.status === 'blocked' ? 'blocked' : row.status === 'ask' ? 'ask' : 'info'} />
                <View style={styles.roleText}>
                  <Text style={styles.roleTitle}>{row.title}</Text>
                  <Text style={styles.small}>{row.line}</Text>
                </View>
              </View>
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
        </Animated.View>
      ) : null}

      {typeof c.experience === 'number' ? (
        <Animated.View entering={enter(2)}>
          <Section icon="briefcase-outline" title="Experience">
            {c.roles.length > 0 ? (
              c.roles.map((role) => {
                const entry = resume?.profile.experience[role.index];
                return (
                  <View key={role.index} style={styles.role}>
                    <Mark kind={role.relevance >= 0.99 ? 'ok' : 'related'} />
                    <View style={styles.roleText}>
                      <Marquee reduced={reduced}>
                        <Text style={styles.roleTitle}>
                          {entry?.title ?? 'A past role'}
                          {entry?.company ? <Text style={styles.roleCompany}> · {entry.company}</Text> : null}
                        </Text>
                      </Marquee>
                      <Text style={styles.small}>
                        {role.relevance >= 0.99 ? 'Same field' : `Related: ${FAMILY_LABELS[role.family] ?? role.family}`}
                        {role.months ? ` · ${role.months} mo` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.body}>
                Nothing on your resume is in {family ?? 'this field'} yet. Past roles count when their title is in the
                same field as the job, or a neighbouring one.
              </Text>
            )}
          </Section>
        </Animated.View>
      ) : null}

      <Animated.View entering={enter(3)}>
        <Section icon="compass-outline" title="Field and level">
          {typeof c.field === 'number' ? (
            <Verdict
              good={c.field >= 0.5}
              title={family ?? 'This role'}
              line={fieldLine(c.field, c.fieldSource)}
            />
          ) : null}
          {typeof c.seniority === 'number' ? (
            <Verdict
              good={c.seniority >= 0.6}
              title={LEVEL_LABELS[job.seniority ?? ''] ?? 'Level unlisted'}
              line={levelLine(c.seniority)}
            />
          ) : null}
        </Section>
      </Animated.View>

      <Animated.View entering={enter(4)}>
        <Section icon="trending-up-outline" title="How to raise it">
          {ideas.length > 0 ? (
            <RaiseIt score={match.score} ideas={ideas} reduced={reduced} />
          ) : (
            <Text style={styles.body}>Nothing big left to fix. This is about as high as this posting goes for you.</Text>
          )}
        </Section>
      </Animated.View>

      <Text style={styles.footnote}>
        Compares {resume ? `your default resume, ${resume.name},` : 'your default resume'} with what the posting asks
        for. No resume matches a posting perfectly, so scores stop at {MATCH_CEILING}.
      </Text>
    </>
  );
}

const LEVEL_LABELS: Record<string, string> = {
  intern: 'Internship',
  new_grad: 'New grad',
  mid: 'Mid-level',
  senior: 'Senior',
  staff_plus: 'Staff+',
};

/** The score as points: one bar per part, then what the ceiling and a cap took off. */
function AddsUp({ parts, jobFamily, reduced }: { parts: Breakdown; jobFamily?: string; reduced: boolean }) {
  const styles = useStyles();
  const final = parts.raw - parts.ceilingCut - parts.capCut;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>How it adds up</Text>
      {parts.rows.map((row, i) => (
        <PartBar key={row.part} part={row.part} points={row.points} max={row.max} index={i} reduced={reduced} />
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
          {listParts(parts.skipped)} could not be judged for this posting, so the rest were reweighted to fill 100.
        </Text>
      ) : null}
    </View>
  );
}

function PartBar({
  part,
  points,
  max,
  index,
  reduced,
}: {
  part: MatchPart;
  points: number;
  max: number;
  index: number;
  reduced: boolean;
}) {
  const styles = useStyles();
  const share = max > 0 ? Math.min(1, points / max) : 0;
  const fill = useSharedValue(reduced ? share : 0);
  useEffect(() => {
    if (!reduced) fill.set(withDelay(250 + index * 90, withTiming(share, { duration: 650, easing: Easing.out(Easing.cubic) })));
  }, [fill, share, index, reduced]);

  return (
    <View style={styles.partRow} accessible accessibilityLabel={`${MATCH_PART_LABELS[part]}: ${points} of ${max} points`}>
      <View style={styles.partHead}>
        <Text style={styles.partLabel}>{MATCH_PART_LABELS[part]}</Text>
        <Text style={styles.partPoints}>
          {points}
          <Text style={styles.partMax}> / {max}</Text>
        </Text>
      </View>
      <Track fill={fill} />
    </View>
  );
}

function Track({ fill }: { fill: SharedValue<number> }) {
  const styles = useStyles();
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.trackFill, fillStyle]} />
    </View>
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

function Section({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.card}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={17} color={colors.text} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
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

function Chip({ label, have, fromWork = false }: { label: string; have: boolean; fromWork?: boolean }) {
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

function Verdict({ good, title, line }: { good: boolean; title: string; line: string }) {
  const styles = useStyles();
  return (
    <View style={styles.verdict}>
      <Mark kind={good ? 'ok' : 'muted'} />
      <View style={styles.roleText}>
        <Text style={styles.roleTitle}>{title}</Text>
        <Text style={styles.small}>{line}</Text>
      </View>
    </View>
  );
}

type MarkKind = 'ok' | 'blocked' | 'ask' | 'info' | 'muted' | 'related';

const MARK_ICONS: Record<MarkKind, keyof typeof Ionicons.glyphMap> = {
  ok: 'checkmark',
  blocked: 'close',
  ask: 'help',
  info: 'information',
  muted: 'remove',
  related: 'git-branch-outline',
};

/**
 * Every status mark on the sheet: one plate, the glyph inside saying what it is. Eligibility and
 * Field used to draw a solid black disc while Experience drew a check on a white one, which read
 * as two kinds of yes.
 */
function Mark({ kind }: { kind: MarkKind }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = kind === 'blocked' ? colors.danger : kind === 'ok' || kind === 'related' ? colors.text : colors.textTertiary;
  return (
    <View style={styles.mark}>
      <Ionicons name={MARK_ICONS[kind]} size={14} color={color} />
    </View>
  );
}

/** Pause at each end, then glide: slow enough to read, at the same speed for any length. */
const MARQUEE_PAUSE = 1400;
const MARQUEE_MS_PER_PT = 28;

/**
 * One line that slides when it does not fit: it rests at the start, glides to show the end, rests,
 * and glides back. A line that fits never moves. With reduced motion it wraps instead.
 */
function Marquee({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  const styles = useStyles();
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  const x = useSharedValue(0);
  const overflow = box > 0 ? Math.max(0, Math.ceil(content - box)) : 0;

  useEffect(() => {
    cancelAnimation(x);
    x.set(0);
    if (reduced || overflow < 2) return;
    const glide = { duration: 400 + overflow * MARQUEE_MS_PER_PT, easing: Easing.inOut(Easing.quad) };
    x.set(
      withRepeat(
        withSequence(withDelay(MARQUEE_PAUSE, withTiming(-overflow, glide)), withDelay(MARQUEE_PAUSE, withTiming(0, glide))),
        -1,
      ),
    );
    return () => cancelAnimation(x);
  }, [overflow, reduced, x]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (reduced) return <>{children}</>;
  return (
    <View style={styles.marquee} onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout.width)}>
      {/* Wider than any title, so the text inside lays out at its natural width and is measured there. */}
      <Animated.View style={[styles.marqueeTrack, slide]}>
        <View onLayout={(e: LayoutChangeEvent) => setContent(e.nativeEvent.layout.width)}>{children}</View>
      </Animated.View>
    </View>
  );
}

/**
 * The changes as a what-if: the bar shows the score now and what the picked changes add, and
 * tapping a change takes it in or out. All picked to start. Each change is priced on its own
 * (suggestions() in lib/matchScore.ts), so the total is their sum held under the ceiling, and
 * says "about".
 */
function RaiseIt({ score, ideas, reduced }: { score: number; ideas: Suggestion[]; reduced: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(ideas.map((idea) => idea.id)));

  const gain = ideas.reduce((sum, idea) => sum + (picked.has(idea.id) ? idea.gain : 0), 0);
  const target = Math.min(MATCH_CEILING, score + gain);

  const added = useSharedValue(reduced ? target - score : 0);
  useEffect(() => {
    const to = target - score;
    added.set(reduced ? to : withTiming(to, { duration: 450, easing: Easing.out(Easing.cubic) }));
  }, [added, target, score, reduced]);
  const addedStyle = useAnimatedStyle(() => ({ width: `${added.value}%` }));

  const toggle = (id: string) => {
    void Haptics.selectionAsync();
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const count = picked.size;
  const caption =
    count === 0 ? 'Pick a change to see what it adds'
      : count === ideas.length ? (ideas.length === 1 ? 'with this change' : `with all ${ideas.length}`)
        : `with ${count} of ${ideas.length}`;

  return (
    <>
      <View style={styles.raiseHead} accessible accessibilityLabel={`From ${score} to about ${target}, ${caption}`}>
        <Text style={styles.raiseNow}>{score}</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.textTertiary} />
        <Text style={[styles.raiseTarget, count === 0 ? styles.raiseTargetIdle : null]}>
          {count === 0 ? score : `~${target}`}
        </Text>
        <Text style={styles.raiseCaption}>{caption}</Text>
      </View>
      <View style={styles.raiseTrack}>
        <View style={[styles.raiseNowFill, { width: `${score}%` }]} />
        <Animated.View style={[styles.raiseAddFill, addedStyle]} />
      </View>

      {ideas.map((idea) => {
        const on = picked.has(idea.id);
        return (
          <Pressable
            key={idea.id}
            onPress={() => toggle(idea.id)}
            style={({ pressed }) => [styles.idea, pressed ? styles.pressed : null]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${idea.title}, plus ${idea.gain}`}>
            <View style={[styles.pick, on ? styles.pickOn : null]}>
              {on ? <Ionicons name="checkmark" size={14} color={colors.goalMet} /> : null}
            </View>
            <View style={styles.ideaText}>
              <Text style={[styles.ideaTitle, on ? null : styles.ideaOff]}>{idea.title}</Text>
              <Text style={styles.small}>{idea.body}</Text>
            </View>
            <Text style={[styles.gainText, on ? null : styles.gainOff]}>+{idea.gain}</Text>
          </Pressable>
        );
      })}
    </>
  );
}

function listParts(parts: MatchPart[]): string {
  const names = parts.map((p) => MATCH_PART_LABELS[p]);
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
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  pressed: { opacity: 0.75 },

  hero: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  close: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
  },
  heroRing: {
    width: HERO_RING,
    height: HERO_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroScore: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  heroPercent: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  heroCaption: {
    marginTop: -2,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textTertiary,
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  // The score's colour at low strength. A layer rather than an alpha suffix, because
  // interpolateColor hands back rgba(), which has no hex digits to append to.
  tierWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.16,
  },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  tierLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  heroJob: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  heroLine: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },

  card: {
    backgroundColor: colors.backgroundMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '800',
    color: colors.text,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
    fontWeight: '700',
    color: colors.text,
  },
  partPoints: {
    fontSize: fontSize.small,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  partMax: {
    fontWeight: '500',
    color: colors.textTertiary,
  },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  deduction: {
    gap: 2,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deductionPoints: {
    fontSize: fontSize.small,
    fontWeight: '800',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
  },
  totalLabel: {
    fontSize: fontSize.body,
    fontWeight: '800',
    color: colors.text,
  },
  totalValue: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  // Room between chips on a row and between wrapped rows, so a long list doesn't read as one block.
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.sm,
  },
  skillGroup: { gap: spacing.sm },
  groupTitle: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendText: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  secondaryButtonText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  heroWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundMuted,
  },
  heroWarningText: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.text,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipHave: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
  },
  chipMissing: {
    borderColor: colors.borderStrong,
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

  role: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  marquee: { overflow: 'hidden' },
  marqueeTrack: {
    flexDirection: 'row',
    width: 2000,
  },
  roleText: { flex: 1, gap: 2 },
  roleTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  roleCompany: {
    fontWeight: '500',
    color: colors.textSecondary,
  },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },

  raiseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  raiseNow: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  raiseTarget: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.goalMet,
    fontVariant: ['tabular-nums'],
  },
  raiseTargetIdle: { color: colors.textTertiary },
  raiseCaption: {
    flex: 1,
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  raiseTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  raiseNowFill: {
    height: '100%',
    backgroundColor: colors.text,
  },
  raiseAddFill: {
    height: '100%',
    backgroundColor: colors.goalMet,
  },
  idea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  // The what-if's tick: the same plate as Mark, ringed while it counts towards the bar.
  pick: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  pickOn: { borderColor: colors.goalMet },
  ideaText: { flex: 1, gap: 2 },
  ideaTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  ideaOff: { color: colors.textSecondary },
  gainText: {
    fontSize: fontSize.body,
    fontWeight: '800',
    color: colors.goalMet,
    fontVariant: ['tabular-nums'],
  },
  gainOff: { color: colors.textTertiary },

  footnote: {
    marginTop: spacing.xs,
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textTertiary,
  },

  locked: {
    minHeight: 400,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  lockedPreview: {
    gap: spacing.md,
  },
  blur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  offer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.sm,
  },
  offerBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  offerBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.accentText,
  },
  offerTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.text,
  },
  perk: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  perkText: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.text,
  },
  offerButton: {
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  offerButtonText: {
    fontSize: fontSize.body,
    fontWeight: '800',
    color: colors.accentText,
  },
}));
