import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, minTapTarget, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface ReelActionRailProps {
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
        label="Like"
        active={isLiked}
        activeColor={colors.like}
        onPress={onLike}
        accessibilityLabel={isLiked ? `Unlike ${jobTitle}` : `Like ${jobTitle}`}
      />
      <RailAction
        icon="chatbubble-outline"
        // The count is the label once there is one: the icon already says what this is,
        // and how busy a thread is decides whether it's worth opening.
        label={commentCount > 0 ? String(commentCount) : 'Comment'}
        onPress={onComment}
        accessibilityLabel={
          commentCount === 0
            ? `Comment on ${jobTitle}`
            : `Comments on ${jobTitle}, ${commentCount} so far`
        }
      />
      <RailAction
        icon="ellipsis-horizontal"
        label="More"
        onPress={onMore}
        accessibilityLabel={`More options for ${jobTitle}`}
      />

      {/*
        * Same shape as every other action — circle on top, label underneath — so the rail
        * reads as one column rather than three icons and a puck. What makes this the hero
        * is the brand fill and a few extra points of diameter, not a different anatomy.
        */}
      <View style={styles.action}>
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
            <Ionicons name="flash" size={21} color={colors.textOnBrand} />
          </Pressable>

          {/* The balance rides on the button rather than sitting under it: the rail is
              already a column of labels, and one more line would read as another action. */}
          <View style={styles.creditBadge}>
            <Text style={styles.creditCount}>{autoApplyCredits}</Text>
          </View>
        </View>

        <Text style={styles.applyLabel}>Auto Apply</Text>
      </View>
    </View>
  );
}

interface RailActionProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
  activeColor?: string;
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
      <View style={[styles.actionCircle, active ? styles.actionCircleActive : null]}>
        <Ionicons name={icon} size={22} color={active ? activeColor ?? colors.text : colors.text} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
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
  actionCircle: {
    width: minTapTarget,
    height: minTapTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Floats on top of the company-tinted reel, so it needs the lifted control surface
    // rather than a flat page surface.
    backgroundColor: colors.controlSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...colors.shadowSoft,
  },
  actionCircleActive: {
    backgroundColor: colors.likeSurface,
    borderColor: colors.likeBorder,
  },
  actionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  applyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    /*
     * 52 against the rail's 44, rather than 64. Big enough to be the obvious one, close
     * enough that it belongs to the same column — at 64 it stopped being emphasis and
     * started being a different component.
     */
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    /*
     * The brand violet, filled, with a white glyph — one colour doing the work.
     *
     * It used to be a near-black puck with a violet icon inside it, which meant two
     * strong colours competing in a 64pt circle on top of an already company-tinted
     * card. The violet was the part carrying the meaning, so it became the whole button.
     */
    backgroundColor: colors.autoApply,
    // A hint of lift, not a halo. The old glow was opacity 0.9 at radius 16, which on a
    // pale reel read as a smudge around the button rather than a shadow under it.
    shadowColor: colors.autoApplyGlow,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
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
    /*
     * Inverted now that the button is violet. It used to be a violet pill with a
     * near-black ring, which worked when it sat on a near-black puck and would now be
     * violet on violet. A light counter reads as something placed on the button.
     */
    backgroundColor: colors.controlSurface,
    borderWidth: 2,
    borderColor: colors.autoApply,
  },
  creditCount: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.autoApply,
  },
  applyLabel: {
    // Matches actionLabel's size and weight; only the colour differs, which is the one
    // signal this action needs that the others do not.
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.autoApply,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
}));
