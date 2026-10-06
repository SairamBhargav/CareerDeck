import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { EASE_OUT, makePaywallStyles, usePaywallColors } from './palette';

/**
 * Blinkist's trial timeline: what happens today, when the reminder comes, and when the first
 * charge lands. Shown only when the store product really has a free trial, because it is a
 * promise. The connecting line fills top to bottom as the steps arrive.
 */
export function TrialTimeline({ days, price, dailyGrant }: { days: number; price: string; dailyGrant: number }) {
  const c = usePaywallColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const fill = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    fill.set(withDelay(500, withTiming(1, { duration: 900, easing: EASE_OUT })));
  }, [reduced, fill]);

  const lineStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: fill.get() }] }));

  const steps = [
    { icon: 'lock-open' as const, title: 'Today', body: `Pro unlocks: ${dailyGrant} Auto Applies a day, starting now.` },
    {
      // Not a reminder: CareerDeck does not send one, and this list is a promise.
      icon: 'time' as const,
      title: `Day ${Math.max(1, days - 1)}`,
      body: 'Last day to cancel in your store settings and pay nothing.',
    },
    { icon: 'star' as const, title: `Day ${days}`, body: `Your plan starts at ${price}.` },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        <Animated.View style={[styles.trackFill, { transformOrigin: 'top' }, lineStyle]} />
      </View>
      {steps.map((step, index) => (
        <Animated.View
          key={step.title}
          entering={reduced ? undefined : FadeInDown.duration(380).delay(500 + index * 260)}
          style={styles.step}>
          <View style={[styles.node, index === 0 && styles.nodeActive]}>
            <Ionicons name={step.icon} size={14} color={index === 0 ? '#FFFFFF' : c.violetText} />
          </View>
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepText}>{step.body}</Text>
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const NODE = 30;

const useStyles = makePaywallStyles((c) => ({
  wrap: {
    gap: 16,
  },
  track: {
    position: 'absolute',
    left: NODE / 2 - 1,
    top: NODE / 2,
    bottom: NODE / 2,
    width: 2,
    backgroundColor: c.hairline,
    overflow: 'hidden',
  },
  trackFill: {
    flex: 1,
    backgroundColor: c.violet,
  },
  step: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.nodeFill,
    borderWidth: 1,
    borderColor: c.nodeBorder,
  },
  nodeActive: {
    backgroundColor: c.violet,
    borderColor: c.violetText,
  },
  stepBody: {
    flex: 1,
    paddingTop: 4,
    gap: 2,
  },
  stepTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: '700',
  },
  stepText: {
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
}));
