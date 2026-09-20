import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, minTapTarget, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface ReelActionRailProps {
  isLiked: boolean;
  onLike: () => void;
  onMore: () => void;
  onAutoApply: () => void;
  jobTitle: string;
  /** Auto Applies left to spend. Shown on the button so the cost is never a surprise. */
  autoApplyCredits: number;
}

/** Vertical social-style rail on the right edge of a reel. */
export function ReelActionRail({
  isLiked,
  onLike,
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
        icon="ellipsis-horizontal"
        label="More"
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
          <Ionicons name="flash" size={22} color={colors.autoApply} />
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
    gap: 2,
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    // Deliberately its own fill rather than `accent` — inverting to white in dark would
    // cost this the "one AI-assisted action" identity the violet glow gives it.
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
    backgroundColor: colors.autoApply,
    borderWidth: 2,
    borderColor: colors.autoApplySurface,
  },
  creditCount: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textOnBrand,
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
