import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { EASE_DRIFT, EASE_IN_OUT, makePaywallStyles, usePaywallColors } from './palette';

const HEIGHT = 58;
const BAND = 90;

/**
 * The one button the paywall exists for: a violet-to-magenta pill with a band of light that
 * sweeps across it every few seconds and a glow that breathes underneath. Presses scale to
 * 0.97 on press-in. Reduce Motion keeps the gradient and drops the sweep and the breathing.
 */
export function ShimmerButton({
  label,
  sublabel,
  onPress,
  loading = false,
  disabled = false,
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const c = usePaywallColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const width = useSharedValue(0);
  const sweep = useSharedValue(0);
  const breathe = useSharedValue(0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    sweep.set(
      withDelay(
        900,
        withRepeat(
          withSequence(withTiming(1, { duration: 1100, easing: EASE_IN_OUT }), withTiming(1, { duration: 1700 })),
          -1,
        ),
      ),
    );
    breathe.set(withRepeat(withTiming(1, { duration: 1800, easing: EASE_DRIFT }), -1, true));
  }, [reduced, sweep, breathe]);

  const onLayout = (event: LayoutChangeEvent) => width.set(event.nativeEvent.layout.width);

  const bandStyle = useAnimatedStyle(() => ({
    // Restarts from the left edge each loop: the sequence above parks it at 1, then the repeat
    // jumps it to 0 while it is off the right edge, so the jump is never seen.
    transform: [{ translateX: -BAND + sweep.get() * (width.get() + BAND * 2) }, { skewX: '-20deg' }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + breathe.get() * 0.35,
    transform: [{ scaleX: 0.9 + breathe.get() * 0.06 }],
  }));

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.get() * 0.03 }],
  }));

  const inactive = disabled || loading;

  return (
    <View>
      <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none" />
      <Pressable
        onPress={onPress}
        disabled={inactive}
        onPressIn={() => pressed.set(withTiming(1, { duration: 110 }))}
        onPressOut={() => pressed.set(withTiming(0, { duration: 160 }))}
        pressRetentionOffset={20}
        accessibilityRole="button"
        accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
        accessibilityState={{ disabled: inactive, busy: loading }}>
        <Animated.View style={[styles.button, inactive && !loading && styles.disabled, pressStyle]} onLayout={onLayout}>
          <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
            <Defs>
              <LinearGradient id="cta" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={c.violet} />
                <Stop offset="1" stopColor={c.magenta} />
              </LinearGradient>
            </Defs>
            <Rect width="100" height="100" fill="url(#cta)" />
          </Svg>

          <Animated.View style={[styles.band, bandStyle]} pointerEvents="none">
            <Svg width={BAND} height={HEIGHT * 2}>
              <Defs>
                <LinearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                  <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.45" />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect width={BAND} height={HEIGHT * 2} fill="url(#shine)" />
            </Svg>
          </Animated.View>

          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.labels}>
              <Text style={styles.label}>{label}</Text>
              {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}
            </View>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const useStyles = makePaywallStyles((c) => ({
  glow: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: 12,
    height: HEIGHT - 6,
    borderRadius: HEIGHT,
    backgroundColor: c.violet,
    shadowColor: c.magenta,
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  button: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.55,
  },
  band: {
    position: 'absolute',
    left: 0,
    top: -HEIGHT / 2,
  },
  labels: {
    alignItems: 'center',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  sublabel: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
}));
