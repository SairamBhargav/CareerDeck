import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { fontSize, minTapTarget, spacing } from '@/constants/theme';
import { usePaywallColors } from '@/components/paywall/palette';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface ReelActionRailProps {
  /** Likes from everybody, not just this reader. Zero hides the number entirely. */
  likeCount: number;
  isLiked: boolean;
  commentCount: number;
  onLike: () => void;
  onComment: () => void;
  onMore: () => void;
  onAutoApply: () => void;
  jobTitle: string;
  /** Auto Applies left to spend. Shown on the button so the cost is never a surprise. */
  autoApplyCredits: number;
}

/** Vertical social-style rail on the right edge of a reel. */
export function ReelActionRail({
  isLiked,
  likeCount,
  commentCount,
  onLike,
  onComment,
  onMore,
  onAutoApply,
  jobTitle,
  autoApplyCredits,
}: ReelActionRailProps) {
  const { colors } = useTheme();
  // The palette Pro is sold under; the ring is the only place the rail uses colour.
  const pro = usePaywallColors();
  const styles = useStyles();

  return (
    <View style={styles.rail}>
      <RailAction
        icon={isLiked ? 'heart' : 'heart-outline'}
        label={likeCount > 0 ? compactCount(likeCount) : undefined}
        active={isLiked}
        activeColor={colors.like}
        onPress={onLike}
        accessibilityLabel={isLiked ? `Unlike ${jobTitle}` : `Like ${jobTitle}`}
      />
      <RailAction
        icon="chatbubble-outline"
        label={commentCount > 0 ? compactCount(commentCount) : undefined}
        onPress={onComment}
        accessibilityLabel={
          commentCount === 0
            ? `Comment on ${jobTitle}`
            : `Comments on ${jobTitle}, ${commentCount} so far`
        }
      />
      <RailAction
        icon="ellipsis-horizontal"
        onPress={onMore}
        accessibilityLabel={`More options for ${jobTitle}`}
      />

      {/*
        * Auto Apply, built like the three actions above it and separated by one thing.
        *
        * It was a 64pt violet plate with a glow under it — the loudest object on a screen
        * whose whole job is to show one posting, and conspicuously the last thing left
        * wearing a filled shape after the rest of the rail gave theirs up. Making it quiet
        * is not the same as making it ordinary, though: it is the one action here that
        * spends something, and that should be visible before it is tapped rather than
        * discovered after.
        *
        * So the same bare mark at the same size, inside a hairline ring drawn in the Pro
        * beam — violet into magenta into gold, the palette this feature is sold under.
        * One stroke, no fill, no glow. It reads as premium because it is the only thing on
        * the rail with a colour at all, not because it is the biggest.
        *
        * The balance moves from a badge on the button to the label underneath, which is
        * where every other count on the rail now lives.
        */}
      <Pressable
        onPress={onAutoApply}
        accessibilityRole="button"
        accessibilityLabel={`Auto apply to ${jobTitle}. ${autoApplyCredits} left this week.`}
        accessibilityHint="Opens the application sheet. Nothing is submitted automatically."
        hitSlop={6}
        style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
        <View style={styles.applyMark}>
          <Svg width={APPLY_RING} height={APPLY_RING} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="autoApplyRing" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={pro.violet} />
                <Stop offset="0.55" stopColor={pro.magenta} />
                <Stop offset="1" stopColor={pro.gold} />
              </LinearGradient>
            </Defs>
            <Circle
              cx={APPLY_RING / 2}
              cy={APPLY_RING / 2}
              r={(APPLY_RING - APPLY_RING_STROKE) / 2}
              stroke="url(#autoApplyRing)"
              strokeWidth={APPLY_RING_STROKE}
              fill="none"
              // Spent, not disabled: the button still opens the ordinary apply sheet, so
              // the ring fades rather than the control greying out.
              strokeOpacity={autoApplyCredits === 0 ? 0.32 : 1}
            />
          </Svg>

          {/*
            * The page's own ink, like the three marks above it.
            *
            * Gold was the obvious choice and is unusable: it measures 1.53:1 against a
            * light page, against a floor of 3 for an icon — invisible in daylight and
            * brilliant in the dark, which is the worst of both. Violet cleared the floor
            * at 4.42 but made two coloured things fight in a 48pt circle, the glyph and
            * the ring it sits inside.
            *
            * So only the ring carries colour, and it is the single coloured object on the
            * rail. The glyph matches its neighbours exactly, which is what makes the ring
            * read as the distinction rather than as decoration around an already-special
            * icon.
            *
            * Outlined rather than solid, for the same reason and one more: a filled bolt
            * inside a ring is two weights of the same idea stacked, a heavy shape wrapped
            * in a hairline. Drawn in line it matches the stroke around it and the
            * chatbubble and heart above it, so the whole column is one weight and only the
            * ring's colour sets this apart.
            */}
          <Ionicons
            name="flash-outline"
            size={22}
            color={autoApplyCredits === 0 ? colors.textTertiary : colors.text}
          />
        </View>

        <Text style={styles.actionLabel}>{autoApplyCredits}</Text>
      </Pressable>
    </View>
  );
}

interface RailActionProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /**
   * Shown under the mark. Omitted where there is nothing to say — a posting nobody has
   * liked yet, and "More", which has never needed a word under three dots.
   */
  label?: string;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
  activeColor?: string;
}

/** 1200 -> 1.2k. A rail is forty-four points wide and four digits do not fit in it. */
function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

function RailAction({ icon, label, onPress, accessibilityLabel, active = false, activeColor }: RailActionProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
      {/* Liking now shows in the mark itself rather than in a plate behind it: the icon
          swaps to the filled heart and takes the like colour. Which is the whole state,
          where before the fill was doing the talking and the icon followed. */}
      <View style={styles.actionCircle}>
        <Ionicons name={icon} size={23} color={active ? activeColor ?? colors.text : colors.text} />
      </View>
      {/*
        * No placeholder when there is no number. An empty line under the mark would hold
        * the rail's spacing steady, which is tidier and a lie — it would read as a count
        * of nothing rather than as an action nobody has taken yet.
        */}
      {label ? <Text style={styles.actionLabel}>{label}</Text> : null}
    </Pressable>
  );
}

/** The ring's box, and the hairline it is drawn with. */
const APPLY_RING = 48;
const APPLY_RING_STROKE = 1.75;

const useStyles = makeStyles((colors) => ({
  rail: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  action: {
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: minTapTarget,
  },
  /*
   * The mark alone, with nothing drawn behind it.
   *
   * This was a lifted white plate per action — surface, hairline border and a soft shadow
   * — on the argument that the icons float over a company-tinted card and need separating
   * from it. They do not: the tint is seven percent in light and twenty in dark, so the
   * card is very nearly the page, and the icons read against it on their own. Three
   * shadowed discs stacked down the edge of a reel were the loudest thing on a screen
   * whose job is to show one posting.
   *
   * The tap target is unchanged; it is the paint that went, not the area.
   */
  /*
   * A few points wider than the other three, which is the only size difference left. Big
   * enough to read as the one that matters, close enough that it still belongs to the
   * column rather than interrupting it.
   */
  applyMark: {
    width: APPLY_RING,
    height: APPLY_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircle: {
    width: minTapTarget,
    height: minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
