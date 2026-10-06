import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { EASE_DRIFT, EASE_OUT, makePaywallStyles, usePaywallColors } from './palette';

/**
 * The paywall's hero: the Deck, applying to itself.
 *
 * A fanned stack of three postings. Every few seconds the front one is stamped APPLIED, flicks
 * off to the right and rejoins the back of the stack. It is the product's own gesture played
 * back as the thing Pro buys more of, which is why it is cards and not a mascot or a chart.
 *
 * The cadence is a React timer (one state change every ~1.4 s, never per frame); every frame
 * of motion runs on the UI thread. Reduce Motion gets the stack, still, with one card stamped.
 */

interface MockJob {
  title: string;
  company: string;
  initial: string;
  tint: string;
  meta: string;
  match: number;
}

const JOBS: MockJob[] = [
  { title: 'Product Designer', company: 'Northwind', initial: 'N', tint: '#FF7A59', meta: 'Remote · $128k', match: 94 },
  { title: 'Software Engineer', company: 'Lumen Labs', initial: 'L', tint: '#3D7BFF', meta: 'New York · $165k', match: 91 },
  { title: 'Data Analyst', company: 'Brightline', initial: 'B', tint: '#2BB673', meta: 'Austin · $98k', match: 88 },
];

const COUNT = JOBS.length;
/** Stamp, then fly, then settle: one full turn of the deck takes this long per card. */
const STAMP_MS = 1100;
const FLY_MS = 520;
const REST_MS = 900;

type Phase = 'rest' | 'stamped' | 'flying';

/** Where each depth in the stack sits. Slot 0 is the front card. */
const SLOTS = [
  { y: 0, scale: 1, rotate: 0 },
  { y: -16, scale: 0.94, rotate: -5 },
  { y: -30, scale: 0.88, rotate: 5 },
];

const REST_SLOT = { y: 0, scale: 1, rotate: 0 };
const slotAt = (slot: number) => SLOTS[slot] ?? REST_SLOT;

export function DeckHero() {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(280, width * 0.7);

  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>(reduced ? 'stamped' : 'rest');

  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    // Waits for the deal-in to land before the first stamp.
    const run = (next: Phase, delay: number) => {
      timer = setTimeout(() => {
        setPhase(next);
        if (next === 'stamped') run('flying', STAMP_MS);
        else if (next === 'flying') {
          setStep((s) => s + 1);
          run('rest', FLY_MS);
        } else run('stamped', REST_MS);
      }, delay);
    };
    run('stamped', 1500);
    return () => clearTimeout(timer);
  }, [reduced]);

  return (
    <View style={[styles.stage, { height: 210 }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Glow />
      {JOBS.map((job, index) => {
        const slot = (((index - step) % COUNT) + COUNT) % COUNT;
        // The card that just left the front is still crossing the stack: keep it on top.
        const leaving = phase === 'flying' && slot === COUNT - 1;
        return (
          <DeckCard
            key={job.title}
            job={job}
            index={index}
            slot={slot}
            stamped={slot === 0 && phase === 'stamped'}
            justLeft={leaving}
            width={cardWidth}
            reduced={reduced}
          />
        );
      })}
    </View>
  );
}

function DeckCard({
  job,
  index,
  slot,
  stamped,
  justLeft,
  width,
  reduced,
}: {
  job: MockJob;
  index: number;
  slot: number;
  stamped: boolean;
  justLeft: boolean;
  width: number;
  reduced: boolean;
}) {
  const c = usePaywallColors();
  const styles = useStyles();
  const { width: screenWidth } = useWindowDimensions();
  const target = slotAt(slot);

  const x = useSharedValue(0);
  const y = useSharedValue(reduced ? target.y : 140);
  const scale = useSharedValue(target.scale);
  const rotate = useSharedValue(target.rotate);
  const opacity = useSharedValue(reduced ? 1 : 0);
  const stamp = useSharedValue(reduced && slot === 0 ? 1 : 0);
  const bob = useSharedValue(0);

  // Deal in from below, back card first, the way a hand lays a deck down.
  useEffect(() => {
    if (reduced) return;
    const delay = 120 + (COUNT - 1 - slot) * 110;
    y.set(withDelay(delay, withSpring(slotAt(slot).y, { duration: 700, dampingRatio: 0.72 })));
    opacity.set(withDelay(delay, withTiming(1, { duration: 280, easing: EASE_OUT })));
    // A slow float on the whole stack, phase-shifted per card so it reads as paper, not a block.
    bob.set(withDelay(900 + index * 300, withRepeat(withTiming(1, { duration: 2600, easing: EASE_DRIFT }), -1, true)));
    // Mount only: later slot changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Moving between depths. Leaving the front is a flick off to the right and a quiet return.
  const lastSlot = useRef(slot);
  useEffect(() => {
    if (reduced || slot === lastSlot.current) return;
    const leftFront = lastSlot.current === 0 && slot === COUNT - 1;
    lastSlot.current = slot;

    if (leftFront) {
      const off = screenWidth * 0.95;
      x.set(withSequence(withTiming(off, { duration: FLY_MS - 40, easing: EASE_OUT }), withTiming(0, { duration: 0 })));
      rotate.set(withSequence(withTiming(22, { duration: FLY_MS - 40, easing: EASE_OUT }), withTiming(target.rotate, { duration: 0 })));
      opacity.set(
        withSequence(
          withTiming(1, { duration: FLY_MS - 40 }),
          withTiming(0, { duration: 0 }),
          withDelay(80, withTiming(1, { duration: 360, easing: EASE_OUT })),
        ),
      );
      y.set(withSequence(withTiming(-20, { duration: FLY_MS - 40, easing: EASE_OUT }), withTiming(target.y, { duration: 0 })));
      scale.set(withSequence(withTiming(1, { duration: FLY_MS - 40 }), withTiming(target.scale * 0.9, { duration: 0 }), withSpring(target.scale, { duration: 500, dampingRatio: 1 })));
      stamp.set(withDelay(FLY_MS, withTiming(0, { duration: 0 })));
      return;
    }

    // Moving up the stack: a settle with no overshoot.
    const spring = { duration: 450, dampingRatio: 1 } as const;
    y.set(withSpring(target.y, spring));
    scale.set(withSpring(target.scale, spring));
    rotate.set(withSpring(target.rotate, spring));
  }, [slot, reduced, screenWidth, target, x, y, scale, rotate, opacity, stamp]);

  // The stamp lands hard and slightly askew: overshoot is right here, it is a physical thud.
  useEffect(() => {
    if (reduced || !stamped) return;
    stamp.set(withSpring(1, { duration: 380, dampingRatio: 0.55 }));
  }, [stamped, reduced, stamp]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [
      { translateX: x.get() },
      { translateY: y.get() + (bob.get() - 0.5) * 6 },
      { rotate: `${rotate.get()}deg` },
      { scale: scale.get() },
    ],
  }));

  const stampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, stamp.get() * 1.6),
    transform: [{ rotate: '-12deg' }, { scale: 1.9 - stamp.get() * 0.9 }],
  }));

  return (
    <Animated.View
      style={[
        styles.card,
        { width, zIndex: justLeft ? COUNT + 1 : COUNT - slot, elevation: justLeft ? COUNT + 1 : COUNT - slot },
        cardStyle,
      ]}>
      <View style={styles.cardTop}>
        <View style={[styles.logo, { backgroundColor: job.tint }]}>
          <Text style={styles.logoText}>{job.initial}</Text>
        </View>
        <View style={styles.cardHeading}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {job.title}
          </Text>
          <Text style={styles.cardCompany} numberOfLines={1}>
            {job.company}
          </Text>
        </View>
        <View style={styles.match}>
          <Text style={styles.matchText}>{job.match}%</Text>
        </View>
      </View>
      <Text style={styles.cardMeta}>{job.meta}</Text>
      <View style={styles.skeleton}>
        <View style={[styles.line, { width: '92%' }]} />
        <View style={[styles.line, { width: '74%' }]} />
      </View>
      <View style={styles.cardFooter}>
        <Ionicons name="flash" size={12} color={c.violetText} />
        <Text style={styles.footerText}>Auto Apply ready</Text>
      </View>

      <Animated.View style={[styles.stamp, stampStyle]}>
        <Ionicons name="checkmark-circle" size={16} color={c.success} />
        <Text style={styles.stampText}>APPLIED</Text>
      </Animated.View>
    </Animated.View>
  );
}

/** A violet pool of light under the stack, breathing slowly. */
function Glow() {
  const styles = useStyles();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.set(withRepeat(withTiming(1, { duration: 2400, easing: EASE_DRIFT }), -1, true));
  }, [reduced, pulse]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.get() * 0.3,
    transform: [{ scaleX: 1 + pulse.get() * 0.12 }],
  }));
  return <Animated.View style={[styles.glow, style]} />;
}

const useStyles = makePaywallStyles((c) => ({
  stage: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 24,
  },
  glow: {
    position: 'absolute',
    bottom: 0,
    width: 240,
    height: 46,
    borderRadius: 120,
    backgroundColor: c.violet,
    shadowColor: c.violet,
    shadowOpacity: 1,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  card: {
    position: 'absolute',
    bottom: 24,
    height: 150,
    borderRadius: 22,
    padding: 16,
    backgroundColor: c.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.cardBorder,
    shadowColor: '#000',
    shadowOpacity: c.cardShadowOpacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  cardHeading: {
    flex: 1,
  },
  cardTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: '700',
  },
  cardCompany: {
    color: c.textTertiary,
    fontSize: 12,
  },
  match: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: c.tintSoft,
  },
  matchText: {
    color: c.violetText,
    fontSize: 11,
    fontWeight: '800',
  },
  cardMeta: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  skeleton: {
    gap: 6,
  },
  line: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.skeleton,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 'auto',
  },
  footerText: {
    color: c.violetText,
    fontSize: 11,
    fontWeight: '700',
  },
  stamp: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: c.success,
    backgroundColor: c.stampFill,
  },
  stampText: {
    color: c.success,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
}));
