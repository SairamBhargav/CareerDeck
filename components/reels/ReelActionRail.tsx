import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, minTapTarget, radius, shadow, spacing } from '@/constants/theme';

interface ReelActionRailProps {
  isLiked: boolean;
  onLike: () => void;
  onMore: () => void;
  onAutoApply: () => void;
  jobTitle: string;
}

/** Vertical social-style rail on the right edge of a reel. */
export function ReelActionRail({ isLiked, onLike, onMore, onAutoApply, jobTitle }: ReelActionRailProps) {
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
}

function RailAction({ icon, label, onPress, accessibilityLabel, active = false, activeColor = colors.text }: RailActionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
      <View style={[styles.actionCircle, active ? styles.actionCircleActive : null]}>
        <Ionicons name={icon} size={22} color={active ? activeColor : colors.text} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.soft,
  },
  actionCircleActive: {
    backgroundColor: '#FFECEF',
    borderColor: '#FFD3DA',
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
    backgroundColor: colors.accent,
    // Black circle, violet icon, violet glow — the glow is what makes this button read
    // as the app's one "AI-assisted" action rather than just another neutral control.
    shadowColor: colors.autoApplyGlow,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  applyLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.accentText,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
