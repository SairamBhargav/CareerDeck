import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { fontSize, minTapTarget, radius, spacing } from '@/constants/theme';
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

      <View>
        <Pressable
          onPress={onAutoApply}
          accessibilityRole="button"
          accessibilityLabel={`Auto apply to ${jobTitle}. ${autoApplyCredits} left this week.`}
          accessibilityHint="Opens the application sheet. Nothing is submitted automatically."
          style={({ pressed }) => [
            styles.applyButton,
            autoApplyCredits === 0 ? styles.applyButtonSpent : null,
            pressed ? styles.pressed : null,
          ]}>
          <Ionicons name="flash" size={22} color={colors.autoApplyIcon} />
          <Text style={styles.applyLabel}>Auto Apply</Text>
        </Pressable>

        {/* The balance rides on the button rather than sitting under it: the rail is
            already a column of labels, and one more line would read as another action. */}
        <View style={styles.creditBadge}>
          <Text style={styles.creditCount}>{autoApplyCredits}</Text>
        </View>
      </View>
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
  applyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    // Deliberately its own fill rather than `accent`: violet in light (the paywall's colour),
    // a violet-black plate in dark. Either way it is the one AI-assisted action on the rail.
    backgroundColor: colors.autoApplySurface,
    shadowColor: colors.autoApplyGlow,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  // Keeps its shape when empty — the button still opens the ordinary apply sheet, so
  // dimming it would promise a wall that isn't there.
  applyButtonSpent: {
    shadowOpacity: 0,
    elevation: 0,
    opacity: 0.72,
  },
  creditBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 21,
    height: 21,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.autoApplyBadge,
    borderWidth: 2,
    borderColor: colors.autoApplySurface,
  },
  creditCount: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.autoApplyBadgeText,
  },
  applyLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.autoApplyLabel,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
}));
