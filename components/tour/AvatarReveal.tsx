import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedBlobatar } from '@blobatar/react-native/animated';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ZoomIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { usePaywallColors } from '@/components/paywall/palette';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const AVATAR = 220;
const TYPE_START_MS = 650;
const TYPE_STEP_MS = 45;

/** Little lights drifting up behind the creature: x offset from centre, size, colour key, delay. */
const MOTES: [number, number, 'violet' | 'magenta' | 'gold', number][] = [
  [-120, 10, 'violet', 200],
  [110, 7, 'magenta', 1400],
  [-70, 6, 'gold', 2300],
  [70, 9, 'violet', 3100],
  [-10, 5, 'magenta', 3800],
  [140, 6, 'gold', 900],
];

interface AvatarRevealProps {
  /** Draws the blob — the account's generated handle, never shown as text. */
  seed: string;
  /** What other people see beside the blob: "Computer Science @ Purdue '27". */
  credential: string;
  onDone: () => void;
}

/**
 * "This is you." The reader meets what every comment of theirs will carry: the same creature
 * `UserAvatar` draws beside them, at full size and alive, and their major, school and year.
 * There are no names, real or generated (2026-10-10) — the blob is the only personal touch.
 *
 * It pops in, keeps bobbing and blinking (the animated Blobatar blinks on its own), the
 * credential types itself out, and the explanation arrives after it. Reduce Motion gets the
 * still version.
 */
export function AvatarReveal({ seed, credential, onDone }: AvatarRevealProps) {
  const { colors, scheme } = useTheme();
  const pro = usePaywallColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const [typed, setTyped] = useState(reduceMotion ? credential.length : 0);
  useEffect(() => {
    if (reduceMotion) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        setTyped((n) => {
          if (n >= credential.length) {
            if (interval) clearInterval(interval);
            return n;
          }
          return n + 1;
        });
      }, TYPE_STEP_MS);
    }, TYPE_START_MS);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [credential, reduceMotion]);

  const bob = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    bob.set(
      withDelay(
        800,
        withRepeat(
          withSequence(
            withTiming(-10, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        ),
      ),
    );
  }, [bob, reduceMotion]);
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));

  const glow = scheme === 'dark' ? 0.38 : 0.24;

  return (
    <Animated.View entering={FadeIn.duration(250)} style={[styles.screen, { paddingTop: insets.top }]}>
      {/* The glow rises from the bottom edge and fades out as it climbs, so the purple is a
          light from below rather than a halo parked behind the blob. */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="meGlow" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={pro.violet} stopOpacity={glow} />
            <Stop offset="0.35" stopColor={pro.violet} stopOpacity={glow * 0.45} />
            <Stop offset="0.7" stopColor={pro.violet} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#meGlow)" />
      </Svg>

      {reduceMotion
        ? null
        : MOTES.map(([dx, size, tone, delay], i) => (
            <Mote key={i} left={width / 2 + dx} size={size} color={pro[tone]} delay={delay} />
          ))}

      <View style={styles.stage}>
        <Animated.View entering={reduceMotion ? undefined : ZoomIn.springify().damping(11).stiffness(140)}>
          <Animated.View style={bobStyle}>
            <AnimatedBlobatar name={seed || 'careerdeck'} size={AVATAR} animate={!reduceMotion} />
          </Animated.View>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(400).duration(400)} style={styles.kicker}>
          THIS IS YOU
        </Animated.Text>
        <Text style={styles.credential} accessibilityLabel={credential}>
          {credential.slice(0, typed)}
          <Text style={styles.caret}>{typed < credential.length ? '▍' : ''}</Text>
        </Text>

        <Animated.Text entering={FadeInDown.delay(1500).duration(450)} style={styles.lead}>
          Next to every comment, people see this creature and your major, school and year. Never a name or email.
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(1800).duration(450)} style={styles.badgeHint}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.badgeText}>Verify your .edu to comment. Only your verified school is shown.</Text>
        </Animated.View>
      </View>

      <Animated.View
        entering={FadeInDown.delay(2100).duration(450)}
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}>
          <Text style={styles.buttonLabel}>Nice to meet me</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function Mote({ left, size, color, delay }: { left: number; size: number; color: string; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withDelay(delay, withRepeat(withTiming(1, { duration: 4500, easing: Easing.in(Easing.quad) }), -1, false)));
  }, [t, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.2 ? t.value * 4.5 : 0.9 * (1 - t.value),
    transform: [{ translateY: -260 * t.value }, { scale: 0.6 + 0.5 * t.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: 480, left, width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl + 4,
  },
  kicker: {
    marginTop: spacing.lg,
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.textTertiary,
  },
  credential: {
    marginTop: 6,
    fontSize: fontSize.display,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  caret: {
    color: colors.autoApply,
  },
  lead: {
    marginTop: spacing.md + 2,
    fontSize: fontSize.body + 1,
    lineHeight: 23,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  badgeHint: {
    marginTop: spacing.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  badgeText: {
    flexShrink: 1,
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  footer: {
    paddingHorizontal: spacing.xl,
  },
  button: {
    height: 56,
    borderRadius: radius.lg - 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  buttonLabel: {
    fontSize: fontSize.body + 2,
    fontWeight: '700',
    color: colors.background,
  },
  pressed: {
    opacity: 0.8,
  },
}));
