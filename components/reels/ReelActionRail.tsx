import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, minTapTarget, radius, spacing } from '@/constants/theme';

interface ReelActionRailProps {
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onMore: () => void;
  onApply: () => void;
  jobTitle: string;
}

/** Vertical social-style rail on the right edge of a reel. */
export function ReelActionRail({
  isLiked,
  isSaved,
  onLike,
  onSave,
  onMore,
  onApply,
  jobTitle,
}: ReelActionRailProps) {
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
        icon={isSaved ? 'bookmark' : 'bookmark-outline'}
        label="Save"
        active={isSaved}
        onPress={onSave}
        accessibilityLabel={isSaved ? `Unsave ${jobTitle}` : `Save ${jobTitle}`}
      />
      <RailAction
        icon="ellipsis-horizontal"
        label="More"
        onPress={onMore}
        accessibilityLabel={`More options for ${jobTitle}`}
      />

      <Pressable
        onPress={onApply}
        accessibilityRole="button"
        accessibilityLabel={`Apply to ${jobTitle}`}
        accessibilityHint="Opens the application sheet. Nothing is submitted."
        style={({ pressed }) => [styles.applyButton, pressed ? styles.pressed : null]}>
        <Ionicons name="paper-plane" size={20} color={colors.text} />
        <Text style={styles.applyLabel}>Apply</Text>
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

function RailAction({
  icon,
  label,
  onPress,
  accessibilityLabel,
  active = false,
  activeColor = colors.reelText,
}: RailActionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
      <View style={[styles.actionCircle, active ? styles.actionCircleActive : null]}>
        <Ionicons name={icon} size={22} color={active ? activeColor : colors.reelText} />
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
    backgroundColor: colors.reelSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.reelBorder,
  },
  actionCircleActive: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  actionLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.reelTextSecondary,
  },
  applyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.reelText,
  },
  applyLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
});
