import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { usePaywallColors } from '@/components/paywall/palette';
import { fontSize, radius, spacing } from '@/constants/theme';

const RING = 132;
const STAGE = '#07060D';

interface TourRewardProps {
  /** What the bonus actually paid; null while the server is answering. */
  paid: number | null;
  before: number;
  error: boolean;
  onRetry: () => void;
  onStart: () => void;
}

/**
 * The end of the tour, on the paywall's own dark stage: the bonus, the balance it moved, and
 * the way into a deck that is already loaded.
 *
 * Nothing is claimed on the screen that the server has not paid. The number waits for
 * `complete_tour()`, and a repeat (a reinstall, a second phone) honestly says nothing new.
 */
export function TourReward({ paid, before, error, onRetry, onStart }: TourRewardProps) {
  const pro = usePaywallColors();
  const insets = useSafeAreaInsets();
  const settled = paid !== null;
  const after = before + (paid ?? 0);

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.screen}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="rewardGlow" cx="50%" cy="38%" r="45%">
            <Stop offset="0" stopColor={pro.violet} stopOpacity={0.45} />
            <Stop offset="0.55" stopColor={pro.magenta} stopOpacity={0.12} />
            <Stop offset="1" stopColor={STAGE} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#rewardGlow)" />
      </Svg>

      <View style={styles.center}>
        {settled ? (
          <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.ring}>
            <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="rewardRing" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={pro.violet} />
                  <Stop offset="0.55" stopColor={pro.magenta} />
                  <Stop offset="1" stopColor={pro.gold} />
                </LinearGradient>
              </Defs>
              <Circle cx={RING / 2} cy={RING / 2} r={RING / 2 - 4} stroke="url(#rewardRing)" strokeWidth={4} fill="none" />
            </Svg>
            <Text style={styles.plus}>+{paid}</Text>
          </Animated.View>
        ) : (
          <View style={styles.ring}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}

        {settled ? (
          <>
            <Animated.Text entering={FadeInDown.delay(250).duration(400)} style={styles.title}>
              {paid && paid > 0 ? `${paid} free Auto Applies are yours` : 'Practice complete'}
            </Animated.Text>
            {paid && paid > 0 ? (
              <Animated.View entering={FadeInDown.delay(450).duration(400)} style={styles.balance}>
                <Text style={styles.balanceLabel}>Balance</Text>
                <Text style={styles.balanceValue}>{before}</Text>
                <Ionicons name="arrow-forward" size={15} color={pro.gold} />
                <Text style={[styles.balanceValue, { color: pro.gold }]}>{after}</Text>
              </Animated.View>
            ) : null}
            <Animated.Text entering={FadeInDown.delay(650).duration(400)} style={styles.lead}>
              Your deck is ready: jobs picked for you, with the newest first.
            </Animated.Text>
          </>
        ) : error ? (
          <Text style={styles.lead}>We couldn&apos;t reach CareerDeck to add your Auto Applies.</Text>
        ) : (
          <Text style={styles.lead}>Adding your Auto Applies…</Text>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable
          onPress={error ? onRetry : onStart}
          disabled={!settled && !error}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, !settled && !error ? styles.waiting : null, pressed ? styles.pressed : null]}>
          <Text style={styles.buttonLabel}>{error ? 'Try again' : 'Start swiping'}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: STAGE,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl + 4,
    gap: spacing.lg + 2,
  },
  ring: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1,
    color: '#FFFFFF',
  },
  title: {
    fontSize: fontSize.display - 2,
    lineHeight: 33,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  balanceLabel: {
    fontSize: fontSize.body,
    color: 'rgba(255,255,255,0.6)',
  },
  balanceValue: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  lead: {
    fontSize: fontSize.body,
    lineHeight: 22,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.72)',
  },
  footer: {
    paddingHorizontal: spacing.xl,
  },
  button: {
    height: 56,
    borderRadius: radius.lg - 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  waiting: {
    opacity: 0.5,
  },
  buttonLabel: {
    fontSize: fontSize.body + 2,
    fontWeight: '700',
    color: '#111114',
  },
  pressed: {
    opacity: 0.8,
  },
});
