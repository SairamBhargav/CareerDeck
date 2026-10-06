import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { EASE_DRIFT, makePaywallStyles, usePaywallColors } from '@/components/paywall/palette';
import { DISPLAY_PRICES } from '@/constants/pricing';
import { fetchPlans } from '@/lib/api';

const RADIUS = 20;
const BORDER = 1.5;

/**
 * Pro's standing place in the app, on Activity under the weekly goal: one dark card that
 * stands out from the page by being the paywall's own colours, with a beam of light running
 * round its edge. The beam is a large gradient square rotating behind a 1.5 pt inset, so the
 * only thing that moves is one transform. Reduce Motion keeps the border, still.
 */
export function ProCard({ onPress }: { onPress: () => void }) {
  const c = usePaywallColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const plans = useQuery({ queryKey: ['plans'], queryFn: fetchPlans, staleTime: 10 * 60_000 });
  const free = plans.data?.find((p) => p.id === 'free')?.dailyGrant ?? 1;
  const pro = plans.data?.find((p) => p.id === 'pro')?.dailyGrant ?? 5;
  const perMonth = `$${(DISPLAY_PRICES.annual.price / 12).toFixed(2)}`;

  const [size, setSize] = useState({ width: 0, height: 0 });
  const spin = useSharedValue(0);
  const twinkle = useSharedValue(0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    spin.set(withRepeat(withTiming(1, { duration: 4200, easing: Easing.linear }), -1));
    twinkle.set(
      withRepeat(
        withSequence(withTiming(1, { duration: 700, easing: EASE_DRIFT }), withTiming(0, { duration: 900, easing: EASE_DRIFT })),
        -1,
      ),
    );
  }, [reduced, spin, twinkle]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };

  // Big enough that its corners never show while it turns.
  const diagonal = Math.ceil(Math.hypot(size.width, size.height)) + 4;

  const beamStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get() * 360}deg` }] }));
  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: 0.6 + twinkle.get() * 0.4,
    transform: [{ scale: 0.85 + twinkle.get() * 0.3 }, { rotate: `${twinkle.get() * 25}deg` }],
  }));
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.get() * 0.03 }] }));

  return (
    <Animated.View entering={reduced ? undefined : FadeInDown.duration(420).delay(150)}>
      <Pressable
        onPress={onPress}
        onPressIn={() => pressed.set(withTiming(1, { duration: 110 }))}
        onPressOut={() => pressed.set(withTiming(0, { duration: 160 }))}
        accessibilityRole="button"
        accessibilityLabel={`CareerDeck Pro. ${pro} Auto Applies a day instead of ${free}. From ${perMonth} a month.`}>
        <Animated.View style={[styles.frame, pressStyle]} onLayout={onLayout}>
          {size.width > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  width: diagonal,
                  height: diagonal,
                  left: (size.width - diagonal) / 2,
                  top: (size.height - diagonal) / 2,
                },
                beamStyle,
              ]}>
              <Svg width={diagonal} height={diagonal}>
                <Defs>
                  <LinearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={c.violet} stopOpacity="0.15" />
                    <Stop offset="0.42" stopColor={c.violet} stopOpacity="0.2" />
                    <Stop offset="0.5" stopColor={c.magenta} stopOpacity="1" />
                    <Stop offset="0.56" stopColor={c.gold} stopOpacity="1" />
                    <Stop offset="0.64" stopColor={c.violet} stopOpacity="0.2" />
                    <Stop offset="1" stopColor={c.violet} stopOpacity="0.15" />
                  </LinearGradient>
                </Defs>
                <Rect width={diagonal} height={diagonal} fill="url(#beam)" />
              </Svg>
            </Animated.View>
          ) : null}

          <View style={styles.card}>
            <Animated.View style={[styles.sparkle, sparkleStyle]}>
              <Ionicons name="sparkles" size={20} color={c.gold} />
            </Animated.View>
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>Go Pro</Text>
                <View style={styles.chip}>
                  <Text style={styles.chipFree}>{free}</Text>
                  <Ionicons name="arrow-forward" size={10} color={c.textTertiary} />
                  <Text style={styles.chipPro}>{pro}</Text>
                  <Text style={styles.chipLabel}>a day</Text>
                </View>
              </View>
              <Text style={styles.subtitle}>More Auto Applies, from {perMonth}/mo</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makePaywallStyles((c) => ({
  frame: {
    borderRadius: RADIUS,
    overflow: 'hidden',
    padding: BORDER,
    backgroundColor: c.promoFrame,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: RADIUS - BORDER,
    backgroundColor: c.promoCard,
  },
  sparkle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.goldSoft,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: c.text,
    fontSize: 16,
    fontWeight: '800',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: c.tintSoft,
  },
  chipFree: {
    color: c.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'line-through',
  },
  chipPro: {
    color: c.violetText,
    fontSize: 12,
    fontWeight: '900',
  },
  chipLabel: {
    color: c.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  subtitle: {
    color: c.textSecondary,
    fontSize: 13,
  },
}));
