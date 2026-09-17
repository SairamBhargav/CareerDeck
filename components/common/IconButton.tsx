import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, type ViewStyle } from 'react-native';

import { minTapTarget, radius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface IconButtonProps {
  name: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  /** Required: icon-only controls have no visible text to announce. */
  accessibilityLabel: string;
  size?: number;
  /** Defaults to the theme's primary text colour. */
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
  color,
  surface = false,
  style,
}: IconButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();

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
      <Ionicons name={name} size={size} color={color ?? colors.text} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
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
}));
