import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { colors, minTapTarget, radius } from '@/constants/theme';

interface IconButtonProps {
  name: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  /** Required: icon-only controls have no visible text to announce. */
  accessibilityLabel: string;
  size?: number;
  color?: string;
  /** Renders a subtle circular background, used on the app shell screens. */
  surface?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  size = 20,
  color = colors.text,
  surface = false,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        surface ? styles.surface : null,
        pressed ? styles.pressed : null,
        style,
      ]}>
      <Ionicons name={name} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: minTapTarget,
    minHeight: minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  surface: {
    backgroundColor: colors.backgroundMuted,
  },
  pressed: {
    opacity: 0.6,
  },
});
