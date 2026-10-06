import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { EASE_DRIFT, EASE_OUT, makePaywallStyles } from './palette';

/**
 * One plan in the picker. The selected one lights a violet border (a pre-drawn layer whose
 * opacity crossfades, never an animated border colour) and its radio dot springs in.
 */
export function PlanOption({
  title,
  price,
  detail,
  badge,
  selected,
  onPress,
}: {
  title: string;
  price: string;
  detail: string;
  badge?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const on = useSharedValue(selected ? 1 : 0);
  const pressed = useSharedValue(0);
  const badgePulse = useSharedValue(0);

  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, { duration: 200, easing: EASE_OUT }));
  }, [selected, on]);

  useEffect(() => {
    if (reduced || !badge) return;
    badgePulse.set(withRepeat(withTiming(1, { duration: 1400, easing: EASE_DRIFT }), -1, true));
  }, [reduced, badge, badgePulse]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.get() * 0.025 }],
  }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.get() }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: on.get(),
    transform: [{ scale: 0.4 + on.get() * 0.6 }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + badgePulse.get() * 0.05 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => pressed.set(withTiming(1, { duration: 110 }))}
      onPressOut={() => pressed.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }))}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${price}, ${detail}${badge ? `, ${badge}` : ''}`}>
      <Animated.View style={[styles.card, cardStyle]}>
        <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />

        <View style={styles.radio}>
          <Animated.View style={[styles.dot, dotStyle]} />
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>

        <Text style={styles.price}>{price}</Text>

        {badge ? (
          <Animated.View style={[styles.badge, badgeStyle]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makePaywallStyles((c) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 20,
    backgroundColor: c.glass,
    borderWidth: 1,
    borderColor: c.hairline,
  },
  ring: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: c.violetText,
    backgroundColor: c.ringFill,
    shadowColor: c.violet,
    shadowOpacity: 0.8,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: c.radioBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: c.violetText,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: c.text,
    fontSize: 17,
    fontWeight: '700',
  },
  detail: {
    color: c.textTertiary,
    fontSize: 13,
  },
  price: {
    color: c.text,
    fontSize: 17,
    fontWeight: '800',
  },
  badge: {
    position: 'absolute',
    top: -11,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: c.gold,
  },
  badgeText: {
    color: '#1A1300',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
}));
