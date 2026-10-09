import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { FollowButton } from '@/components/common/FollowButton';
import { SkillChip } from '@/components/common/SkillChip';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { LikeBurst } from '@/components/reels/LikeBurst';
import { ReelActionRail } from '@/components/reels/ReelActionRail';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Job } from '@/types';
import { hexToRgba } from '@/utils/color';
import { formatPostedAt } from '@/utils/format';
import { parseJobSections } from '@/utils/jobSections';

const MAX_SKILL_CHIPS = 6;
/** A long title wraps to three lines at most; the rest is in the sheet. */
const MAX_TITLE_LINES = 3;
/** Width reserved on the right so caption text never runs under the action rail. */
/**
 * Hearts allowed in flight at once.
 *
 * Each lives about six hundred milliseconds, so twelve is more than anybody can put on
 * screen by tapping — the cap is there so a stuck finger cannot grow the list without
 * bound, not to ration the effect.
 */
const MAX_BURSTS = 12;

/*
 * Module scope, not a ref.
 *
 * The gesture is built during render and closes over the handler that allocates an id, so
 * a ref here is a ref read during render — which the hooks lint catches, correctly. Ids
 * only have to be unique among the hearts currently mounted, so one counter shared by
 * every card is more than enough.
 */
let burstSeq = 0;

const RAIL_RESERVED_WIDTH = 92;
/** Lifts the action rail (and Read more, which stays level with it) off the very bottom edge. */
const RAIL_LIFT = spacing.sm;
/** Extra breathing room between the end of the caption and the rail line, on top of RAIL_LIFT. */
const CONTENT_BOTTOM_GAP = spacing.xl;
/** Must match `description`'s own lineHeight — it's what one clamped line gives back. */
const DESCRIPTION_LINE_HEIGHT = 22;
/** Never clamp the blurb below this, however tight the card gets. */
const MIN_DESCRIPTION_LINES = 2;

interface JobReelCardProps {
  job: Job;
  /** Exact height of one page so paging lands on card boundaries. */
  height: number;
  /** Space reserved for the feed toggle above and the tab bar below. */
  paddingTop: number;
  paddingBottom: number;
  logoColor?: string;
  /** Company's real logo image, when available — falls back to job.companyLogo's monogram. */
  logoUrl?: string;
  commentCount: number;
  onLike: () => void;
  onComment: () => void;
  onMore: () => void;
  onAutoApply: () => void;
  /** Tapping the logo or company name. */
  onCompanyPress: () => void;
  isFollowing: boolean;
  onToggleFollow: () => void;
  autoApplyCredits: number;
}

export function JobReelCard({
  job,
  height,
  paddingTop,
  paddingBottom,
  logoColor,
  logoUrl,
  commentCount,
  onLike,
  onComment,
  onMore,
  onAutoApply,
  onCompanyPress,
  isFollowing,
  onToggleFollow,
  autoApplyCredits,
}: JobReelCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const skills = job.skills.slice(0, MAX_SKILL_CHIPS);
  /*
   * The caption is the posting's own summary — one to three of the employer's sentences about
   * the role, 130–300 characters — rather than whatever the raw text opened with. That is what
   * makes every reel carry about the same amount of copy. utils/jobSections.ts.
   */
  const sections = useMemo(
    () => parseJobSections(job.description, job),
    [job],
  );
  // How tall the caption's box actually is: the rail's own lift, plus extra room so the
  // text visibly stops short of the rail line instead of running right up to it.
  const availableContentHeight = height - paddingTop - paddingBottom - RAIL_LIFT - CONTENT_BOTTOM_GAP;

  // Both measured on the first, unclamped pass and then frozen: clamping the blurb
  // shrinks the caption, which would otherwise re-fire these and oscillate. "Read more"
  // renders on every card, so it's already inside `content` — the overflow is exactly
  // what the description owes back, with nothing further to reserve.
  const [natural, setNatural] = useState<{ content: number; description: number } | null>(null);
  const measured = useRef<{ content?: number; description?: number }>({});

  const overflowBy = natural === null ? 0 : natural.content - availableContentHeight;

  // Trim the blurb by exactly that, so the skill chips below it always land whole
  // instead of being sliced by the clipping box. Left alone when the copy already fits.
  const descriptionLines =
    natural !== null && overflowBy > 0
      ? Math.max(
          MIN_DESCRIPTION_LINES,
          Math.floor((natural.description - overflowBy) / DESCRIPTION_LINE_HEIGHT),
        )
      : undefined;

  /*
   * Hearts in flight, one per double tap.
   *
   * A list rather than a single replayed animation, because tapping again while one is
   * still rising should add a heart, not restart the one already there. Each entry
   * unmounts itself when its animation ends.
   */
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number; tilt: number }[]>([]);

  const dropBurst = useCallback((id: number) => {
    setBursts((current) => current.filter((burst) => burst.id !== id));
  }, []);

  const addBurst = useCallback((x: number, y: number) => {
    burstSeq += 1;
    const id = burstSeq;
    setBursts((current) => [
      // Bounded, so holding a thumb down and tapping as fast as possible cannot grow this
      // without limit. Twelve is far more than are ever visible at once.
      ...current.slice(-(MAX_BURSTS - 1)),
      { id, x, y, tilt: Math.round((id % 7) * 5 - 15) },
    ]);
  }, []);

  // The rail's heart. A toggle, because tapping a filled heart to unlike is what the icon
  // promises.
  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLike();
  };

  /*
   * Double tap only ever likes.
   *
   * It used to call the same toggle as the rail, so a second double tap quietly took the
   * like back while still playing a heart — the animation said one thing and the state did
   * the opposite. Tapping twice is an expression of enthusiasm, and the honest reading of
   * doing it repeatedly is "yes, still", not "no".
   */
  const handleDoubleTapLike = (x: number, y: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addBurst(x, y);
    if (!job.isLiked) onLike();
  };

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((event, success) => {
      // x and y are relative to the tap area, which is what positions the heart on the
      // fingers rather than in the middle of the card.
      if (success) runOnJS(handleDoubleTapLike)(event.x, event.y);
    });

  // Each half arrives in its own layout pass; commit once both have, and only the first
  // time, so the frozen numbers describe unclamped copy.
  const capture = (key: 'content' | 'description') => (event: LayoutChangeEvent) => {
    const measurement = event.nativeEvent.layout.height;
    if (measurement <= 0 || measured.current[key] !== undefined) return;

    measured.current[key] = measurement;
    const { content, description } = measured.current;
    if (content !== undefined && description !== undefined) setNatural({ content, description });
  };

  return (
    <View style={[styles.page, { height, paddingTop, paddingBottom }]}>
      {/* A soft full-bleed wash of the company's brand color, plus a stronger accent
          glow behind the logo — gives each reel its own identity without a loud gradient.
          Both alphas come from the palette: over a near-black page the light-mode values
          would be invisible, so dark leans on the brand colour far harder. */}
      <View
        pointerEvents="none"
        style={[
          styles.wash,
          logoColor ? { backgroundColor: hexToRgba(logoColor, colors.reelWashAlpha) } : null,
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          logoColor ? { backgroundColor: hexToRgba(logoColor, colors.reelGlowAlpha) } : null,
        ]}
      />

      <GestureDetector gesture={doubleTap}>
        <View style={styles.tapZone}>
          <View
            style={[
              styles.contentBox,
              { paddingRight: RAIL_RESERVED_WIDTH, paddingBottom: RAIL_LIFT + CONTENT_BOTTOM_GAP },
            ]}>
            {/* Free to size to its content on the first pass, which is what lets onLayout
                report the true un-clamped height. contentBox's fixed height still clips
                that pass; once the description is clamped, everything fits inside it. */}
            <View style={styles.contentInner} onLayout={capture('content')}>
              {/* The logo and name open the company's page, as a profile picture does. */}
              <View style={styles.companyRow}>
                <Pressable
                  onPress={onCompanyPress}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${job.companyName}'s page`}
                  hitSlop={6}
                  style={styles.companyIdentity}>
                  <CompanyLogo logo={logoUrl ?? job.companyLogo} name={job.companyName} color={logoColor} size="md" />
                  <View style={styles.companyText}>
                    <Text style={styles.companyName} numberOfLines={1}>
                      {job.companyName}
                    </Text>
                    <Text style={styles.posted}>{formatPostedAt(job.postedAt)}</Text>
                  </View>
                </Pressable>

                {/*
                  * Following, from the card itself.
                  *
                  * Until now the only way to follow from the Deck was to open the company
                  * page and come back, which is a long way round for a decision made while
                  * looking at the posting that prompted it. Beside the name rather than in
                  * the rail: the rail is about this posting, and following is about who
                  * wrote it.
                  *
                  * A sibling of the identity rather than inside it, so tapping follow does
                  * not also open the company.
                  */}
                <FollowButton
                  isFollowing={isFollowing}
                  companyName={job.companyName}
                  onToggle={onToggleFollow}
                  size="sm"
                  variant="minimal"
                />
              </View>

              <Text style={styles.title} numberOfLines={MAX_TITLE_LINES}>
                {job.title}
              </Text>

              <JobMetadata job={job} emphasizeSalary />

              <View style={styles.descriptionBlock}>
                <Text
                  style={styles.description}
                  numberOfLines={descriptionLines}
                  onLayout={capture('description')}>
                  {sections.summary}
                </Text>

                {/* A posting whose employer page could not be read: say what the listing did. */}
                {sections.facts.length > 0 ? (
                  <View style={styles.facts}>
                    {sections.facts.map((fact) => (
                      <Text key={fact.label} style={styles.fact} numberOfLines={1}>
                        <Text style={styles.factLabel}>{fact.label} </Text>
                        {fact.value}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {/* On every card, not just clamped ones: the sheet always carries the
                    full requirements list, which the reel never shows at all. */}
                <Pressable
                  onPress={onMore}
                  accessibilityRole="button"
                  accessibilityLabel={'Read the full posting for ' + job.title}
                  hitSlop={8}
                  style={({ pressed }) => [styles.readMore, pressed ? styles.readMorePressed : null]}>
                  <Text style={styles.readMoreLabel}>Read more</Text>
                  <Ionicons name="chevron-down" size={11} color={colors.text} />
                </Pressable>
              </View>

              <View style={styles.skills}>
                {skills.map((skill) => (
                  <SkillChip key={skill} label={skill} />
                ))}
              </View>
            </View>
          </View>

          {bursts.map((burst) => (
            <LikeBurst
              key={burst.id}
              x={burst.x}
              y={burst.y}
              tilt={burst.tilt}
              onDone={() => dropBurst(burst.id)}
            />
          ))}
        </View>
      </GestureDetector>

      <View style={[styles.rail, { bottom: paddingBottom + RAIL_LIFT }]}>
        <ReelActionRail
          isLiked={job.isLiked}
          commentCount={commentCount}
          onLike={handleLike}
          onComment={onComment}
          onMore={onMore}
          onAutoApply={onAutoApply}
          jobTitle={job.title}
          autoApplyCredits={autoApplyCredits}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  page: {
    width: '100%',
    paddingHorizontal: screenPadding,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  tapZone: {
    flex: 1,
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.canvasMuted,
  },
  glow: {
    position: 'absolute',
    top: -160,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: radius.pill,
    // Pre-blended fallback for the rare case a job's company has no brand color; the
    // inline style above overrides this with the real tint.
    backgroundColor: colors.reelGlowFallback,
  },
  // Top-anchored (never centered) so every reel's caption starts at the same spot
  // regardless of description length, and hard-clipped at the bottom so it can grow to
  // fill all the way down to the action rail without ever running past it.
  contentBox: {
    flex: 1,
    overflow: 'hidden',
  },
  contentInner: {
    gap: spacing.md,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // Takes the room the follow control does not, so a long company name truncates rather
  // than pushing the control off the card.
  companyIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  companyText: {
    flex: 1,
  },
  companyName: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  posted: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  title: {
    fontSize: fontSize.hero,
    lineHeight: 39,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
  },
  description: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  facts: {
    gap: 2,
  },
  fact: {
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  factLabel: {
    fontWeight: '700',
    color: colors.text,
  },
  // One row, clipped: a second row of chips is what pushed the caption past the rail.
  skills: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    overflow: 'hidden',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  // Kept tight to the blurb it continues, with less air than contentInner's own gap.
  descriptionBlock: {
    gap: spacing.xs,
  },
  // Part of the caption rather than a control floating over it: no pill, no border, no
  // shadow — just the one line of the copy that happens to be tappable, which is why it
  // takes the full-strength text colour the body copy around it doesn't.
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
  },
  readMorePressed: {
    opacity: 0.7,
  },
  readMoreLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  rail: {
    position: 'absolute',
    right: screenPadding,
  },
}));
