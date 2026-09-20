import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, minTapTarget, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface ReelActionRailProps {
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onAutoApply: () => void;
  jobTitle: string;
}

/**
 * Vertical social-style rail on the right edge of a reel: the three things you do to a
 * job. The middle slot used to be an "ellipsis" that opened the details sheet, which is
 * what the caption's own "Read more" already does — and left Save unreachable from this
 * tab entirely, despite Activity telling people to save from here.
 */
export function ReelActionRail({ isLiked, isSaved, onLike, onSave, onAutoApply, jobTitle }: ReelActionRailProps) {
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
        highlightSurface
        accessibilityLabel={isLiked ? `Unlike ${jobTitle}` : `Like ${jobTitle}`}
      />
      <RailAction
        icon={isSaved ? 'bookmark' : 'bookmark-outline'}
        label="Save"
        active={isSaved}
        onPress={onSave}
        accessibilityLabel={isSaved ? `Unsave ${jobTitle}` : `Save ${jobTitle}`}
      />

      <Pressable
        onPress={onAutoApply}
        accessibilityRole="button"
        accessibilityLabel={`Auto apply to ${jobTitle}`}
        accessibilityHint="Opens the application sheet. Nothing is submitted automatically."
        style={({ pressed }) => [styles.applyButton, pressed ? styles.pressed : null]}>
        <Ionicons name="flash" size={22} color={colors.autoApply} />
        <Text style={styles.applyLabel}>Auto Apply</Text>
      </Pressable>
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
  /** Washes the circle behind the icon too. Like wants it; Save just fills its bookmark. */
  highlightSurface?: boolean;
}

function RailAction({
  icon,
  label,
  onPress,
  accessibilityLabel,
  active = false,
  activeColor,
  highlightSurface = false,
}: RailActionProps) {
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
      <View style={[styles.actionCircle, active && highlightSurface ? styles.actionCircleActive : null]}>
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
