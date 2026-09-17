import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { radius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const KNOB_SIZE = 24;
const KNOB_INSET = 3;
const TRAVEL = TRACK_WIDTH - KNOB_INSET * 2 - KNOB_SIZE;

const SPRING = { damping: 15, stiffness: 190 };

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
}

/**
 * A plain on/off pill switch for settings that don't need their own iconography —
 * ThemeSwitch is the specialised, sun/moon version of the same shape for dark mode.
 */
export function Toggle({ value, onValueChange, accessibilityLabel }: ToggleProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    t.value = withSpring(value ? 1 : 0, SPRING);
  }, [value, t]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: t.value > 0.5 ? colors.autoApply : colors.borderStrong,
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: t.value * TRAVEL }],
  }));

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
      hitSlop={8}>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  track: StyleSheet.flatten({
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    padding: KNOB_INSET,
    justifyContent: 'center',
  }),
  knob: StyleSheet.flatten({
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  }),
}));
