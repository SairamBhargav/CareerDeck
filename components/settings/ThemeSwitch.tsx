import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { radius } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

const TRACK_WIDTH = 64;
const TRACK_HEIGHT = 34;
const KNOB_SIZE = 26;
const KNOB_INSET = 4;
const TRAVEL = TRACK_WIDTH - KNOB_INSET * 2 - KNOB_SIZE;

const SPRING = { damping: 15, stiffness: 190 };

/** The switch's own two ends, independent of the surrounding palette. */
const TRACK_DAY = '#E4E4E9';
const TRACK_NIGHT = '#2A2340';
const KNOB_DAY = '#FFFFFF';
const KNOB_NIGHT = '#F4F4F7';
const SUN = '#F5A623';
const MOON = '#7B5CFA';

/**
 * Day/night switch for the app's colour scheme: the sun tips out and shrinks as the moon
 * rotates up to meet it, and a pair of stars fade in over the night side of the track.
 */
export function ThemeSwitch() {
  const { scheme, toggleScheme } = useTheme();
  const isDark = scheme === 'dark';

  const t = useSharedValue(isDark ? 1 : 0);

  // The scheme flips synchronously on press, so this is what actually drives the knob.
  useEffect(() => {
    t.value = withSpring(isDark ? 1 : 0, SPRING);
  }, [isDark, t]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(t.value, [0, 1], [TRACK_DAY, TRACK_NIGHT]),
  }));

  const knobStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(t.value, [0, 1], [KNOB_DAY, KNOB_NIGHT]),
    shadowOpacity: interpolate(t.value, [0, 1], [0.18, 0.5]),
    transform: [{ translateX: t.value * TRAVEL }],
  }));

  const sunStyle = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ rotate: `${t.value * 90}deg` }, { scale: 1 - t.value * 0.45 }],
  }));

  const moonStyle = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ rotate: `${(t.value - 1) * 90}deg` }, { scale: 0.55 + t.value * 0.45 }],
  }));

  const starsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.35, 1], [0, 1]),
    transform: [{ scale: interpolate(t.value, [0.35, 1], [0.4, 1]) }],
  }));

  return (
    <Pressable
      onPress={toggleScheme}
      accessibilityRole="switch"
      accessibilityLabel="Dark mode"
      accessibilityState={{ checked: isDark }}
      hitSlop={8}>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.stars, starsStyle]}>
          <View style={[styles.star, styles.starBig]} />
          <View style={[styles.star, styles.starSmall]} />
        </Animated.View>

        <Animated.View style={[styles.knob, knobStyle]}>
          <Animated.View style={[styles.icon, sunStyle]}>
            <Ionicons name="sunny" size={15} color={SUN} />
          </Animated.View>
          <Animated.View style={[styles.icon, moonStyle]}>
            <Ionicons name="moon" size={13} color={MOON} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    padding: KNOB_INSET,
    justifyContent: 'center',
  },
  stars: {
    position: 'absolute',
    left: 11,
    top: 10,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
  },
  starBig: {
    width: 3,
    height: 3,
  },
  starSmall: {
    width: 2,
    height: 2,
    left: 7,
    top: 7,
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  icon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
