import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  ZoomIn,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuroraBackground } from '@/components/paywall/AuroraBackground';
import { Confetti } from '@/components/paywall/Confetti';
import { DeckHero } from '@/components/paywall/DeckHero';
import { makePaywallStyles, usePaywallColors } from '@/components/paywall/palette';
import { PlanOption } from '@/components/paywall/PlanOption';
import { ShimmerButton } from '@/components/paywall/ShimmerButton';
import { TrialTimeline } from '@/components/paywall/TrialTimeline';
import { AUTO_APPLY_ECONOMY } from '@/constants/goal';
import { FREE_RESUME_LIMIT } from '@/constants/limits';
import { annualSavingsPercent, DISPLAY_PRICES } from '@/constants/pricing';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { fetchCredits, fetchPlans, fetchSubscription } from '@/lib/api';
import {
  fetchOffers,
  isBillingConfigured,
  isPreviewMode,
  purchase,
  restorePurchases,
  type PlanOffer,
} from '@/lib/billing';
import { reportError } from '@/lib/observability';
import type { PaywallSource } from '@/lib/paywallPrompts';

type EnteringAnimation = ComponentProps<typeof Animated.View>['entering'];

/** How long to wait for RevenueCat's webhook to land after a purchase before saying so. */
const ACTIVATION_TIMEOUT_MS = 30_000;
const ACTIVATION_POLL_MS = 2_000;

/** Apple's standard licence agreement, which an auto-renewing subscription must link to. */
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

/** The `pro` row in `plans`, for the first paint before the table answers. */
const PRO_FALLBACK = { dailyGrant: 5, bankCap: 25, resumeLimit: 10 };

/**
 * After a purchase: re-read the plan until the webhook has landed, or give up saying so.
 * Reads `my_credits()` — the server's answer, never the store's receipt.
 */
async function waitForPaidPlan(): Promise<boolean> {
  const deadline = Date.now() + ACTIVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const credits = await fetchCredits().catch(() => null);
    if (credits && credits.plan !== 'free') return true;
    await new Promise((resolve) => setTimeout(resolve, ACTIVATION_POLL_MS));
  }
  return false;
}

const HEADLINES: Record<PaywallSource, { title: string; lede: (pro: number) => string }> = {
  welcome: {
    title: 'Land the job faster',
    lede: (pro) => `Pro gives you ${pro} Auto Applies a day, so every great match gets an application the day it drops.`,
  },
  'first-auto-apply': {
    title: 'That took seconds.\nNow do it daily.',
    lede: (pro) => `You just sent your first Auto Apply. Pro turns one a day into ${pro}.`,
  },
  limit: {
    title: 'Out of Auto Applies?',
    lede: (pro) => `Pro refills ${pro} every day and banks what you don’t use.`,
  },
  activity: {
    title: 'Apply to more.\nHear back sooner.',
    lede: (pro) => `${pro} Auto Applies a day, more resumes, and everything free stays free.`,
  },
  settings: {
    title: 'CareerDeck Pro',
    lede: (pro) => `${pro} Auto Applies a day, more resumes, and everything free stays free.`,
  },
};

type PlanKey = 'annual' | 'monthly';

interface DisplayPlan {
  key: PlanKey;
  title: string;
  price: string;
  priceAmount: number;
  perMonth: string;
  trialDays: number;
  /** Undefined until the store answers, or on a build with no store keys. */
  offer?: PlanOffer;
}

/**
 * The paywall, §8: the one screen in the app that sells anything.
 *
 * Built after the famous ones: Spotify and Calm's two stacked plans with the annual preselected
 * and its saving spelled out, Duolingo's cinematic always-dark stage, and Blinkist's trial
 * timeline when there is a trial. The hero is the Deck stamping its own cards APPLIED, which
 * is the thing Pro sells more of.
 *
 * Three rules from the first version still decide what is on it:
 *
 *  - **The free tier is genuinely useful.** The feature list shows free's number beside Pro's,
 *    and the footer says lapsing keeps everything.
 *  - **Entitlements come from webhooks.** A completed purchase flips nothing here. The screen
 *    waits for `my_credits()` to report the new plan and says "activating" until then.
 *  - **The numbers are the server's.** The features read the `plans` table the gates read.
 *
 * Prices are the store's once it answers. Before then, and on a build with no store keys, they
 * are `DISPLAY_PRICES`, and buying says plainly that it is not switched on yet.
 */
export default function PaywallScreen() {
  const c = usePaywallColors();
  const styles = useStyles();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { from } = useLocalSearchParams<{ from?: PaywallSource }>();
  const source: PaywallSource = from && from in HEADLINES ? from : 'settings';
  const { credits } = useCareerDeck();

  const plans = useQuery({ queryKey: ['plans'], queryFn: fetchPlans, staleTime: 10 * 60_000 });
  const offers = useQuery({
    queryKey: ['billing', 'offers'],
    queryFn: fetchOffers,
    enabled: isBillingConfigured(),
    staleTime: 10 * 60_000,
  });
  const subscription = useQuery({
    queryKey: ['subscription', credits.plan],
    queryFn: fetchSubscription,
    enabled: credits.isPro,
  });

  const free = plans.data?.find((p) => p.id === 'free') ?? {
    dailyGrant: AUTO_APPLY_ECONOMY.dailyGrant,
    bankCap: AUTO_APPLY_ECONOMY.bankCap,
    resumeLimit: FREE_RESUME_LIMIT,
  };
  const pro = plans.data?.find((p) => p.id === 'pro') ?? PRO_FALLBACK;

  const choices = useMemo(() => displayPlans(offers.data ?? []), [offers.data]);
  const savings = annualSavingsPercent(choices.monthly.priceAmount, choices.annual.priceAmount);

  const [selected, setSelected] = useState<PlanKey>('annual');
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  const chosen = choices[selected];

  const choose = (key: PlanKey) => {
    if (key === selected) return;
    void Haptics.selectionAsync();
    setSelected(key);
  };

  /*
   * The plan the rest of the app reads is `credits`, so once the wait sees Pro it refreshes that
   * one query and the shelf, the Auto Apply button and Settings all change together.
   */
  const activate = async () => {
    setActivating(true);
    const active = await waitForPaidPlan();
    await credits.refresh();
    setActivating(false);
    if (active) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCelebrating(true);
    } else {
      setMessage(
        'Your purchase went through, and it’s taking longer than usual to activate. It will switch on by itself — you don’t need to buy again.',
      );
    }
  };

  const buy = async () => {
    setMessage(null);
    if (!chosen.offer) {
      setMessage(
        isBillingConfigured()
          ? 'Prices are still loading. Try again in a moment.'
          : 'Subscriptions switch on once CareerDeck is in the App Store. Nothing was charged.',
      );
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy(true);
    try {
      const outcome = await purchase(chosen.offer);
      if (outcome === 'purchased') await activate();
    } catch (error) {
      reportError(error, { where: 'paywall.purchase' });
      setMessage(error instanceof Error ? error.message : 'The purchase did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setMessage(null);
    try {
      await restorePurchases();
      await activate();
    } catch (error) {
      reportError(error, { where: 'paywall.restore' });
      setMessage('Nothing to restore on this account.');
    }
  };

  const manage = () => {
    void Linking.openURL(
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions',
    );
  };

  /** Entrance choreography: hero deals in, then the words, then the decision. */
  const enter = (delay: number): EnteringAnimation => (reduced ? FadeIn.duration(200) : FadeInDown.duration(520).delay(delay).springify().dampingRatio(0.85));

  if (celebrating) {
    return <Celebration dailyGrant={pro.dailyGrant} onDone={() => router.back()} />;
  }

  const headline = HEADLINES[source];
  const ctaLabel = chosen.trialDays > 0 ? `Start my ${chosen.trialDays}-day free trial` : 'Continue';
  const ctaSub =
    chosen.key === 'annual' ? `${chosen.price} a year · just ${chosen.perMonth}/mo` : `${chosen.price} a month`;

  return (
    <View style={styles.screen}>
      <StatusBar style={c.statusBar} />
      <AuroraBackground />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Animated.View entering={FadeIn.duration(300).delay(reduced ? 0 : 350)} style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={c.textSecondary} />
          </Pressable>
        </Animated.View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <DeckHero />

          <Animated.View entering={reduced ? FadeIn : ZoomIn.duration(420).delay(300).springify().dampingRatio(0.6)} style={styles.proPill}>
            <Ionicons name="sparkles" size={12} color="#1A1300" />
            <Text style={styles.proPillText}>{credits.isPro ? 'YOU’RE ON PRO' : 'CAREERDECK PRO'}</Text>
          </Animated.View>

          <Animated.Text entering={enter(380)} style={styles.title} accessibilityRole="header">
            {credits.isPro ? 'Thanks for going Pro' : headline.title}
          </Animated.Text>
          <Animated.Text entering={enter(460)} style={styles.lede}>
            {credits.isPro ? statusLine(subscription.data ?? null) : headline.lede(pro.dailyGrant)}
          </Animated.Text>

          <View style={styles.features}>
            <Feature delay={560} enter={enter} icon="flash" title="Auto Applies every day" free={free.dailyGrant} pro={pro.dailyGrant} />
            <Feature delay={640} enter={enter} icon="layers" title="Banked for busy weeks" free={free.bankCap} pro={pro.bankCap} />
            <Feature delay={720} enter={enter} icon="document-text" title="Resumes on your shelf" free={free.resumeLimit} pro={pro.resumeLimit} />
            <Feature delay={800} enter={enter} icon="heart" title="The feed, saving and tracker" note="Always free" />
          </View>

          {credits.isPro ? null : (
            <Animated.View entering={enter(900)} style={styles.plans} accessibilityRole="radiogroup">
              <PlanOption
                title="Yearly"
                price={choices.annual.price}
                detail={`${choices.annual.perMonth}/mo, billed yearly`}
                badge={savings > 0 ? `BEST VALUE · SAVE ${savings}%` : 'BEST VALUE'}
                selected={selected === 'annual'}
                onPress={() => choose('annual')}
              />
              <PlanOption
                title="Monthly"
                price={choices.monthly.price}
                detail="Billed monthly"
                selected={selected === 'monthly'}
                onPress={() => choose('monthly')}
              />
            </Animated.View>
          )}

          {!credits.isPro && chosen.trialDays > 0 ? (
            <Animated.View key={selected} entering={FadeIn.duration(250)}>
              <TrialTimeline days={chosen.trialDays} price={ctaSub} dailyGrant={pro.dailyGrant} />
            </Animated.View>
          ) : null}

          <Text style={styles.footnote}>
            If Pro lapses you keep every application, resume and credit you have.
          </Text>
        </ScrollView>

        <Animated.View entering={enter(1000)} style={styles.bottom}>
          {message ? (
            <Animated.Text entering={FadeIn.duration(200)} style={styles.message}>
              {message}
            </Animated.Text>
          ) : null}
          {isPreviewMode() && !credits.isPro ? (
            <Text style={styles.preview}>Expo Go: purchases here are simulated and won’t activate Pro.</Text>
          ) : null}

          {credits.isPro ? (
            <ShimmerButton label="Manage subscription" onPress={manage} />
          ) : (
            <ShimmerButton
              label={activating ? 'Activating Pro…' : ctaLabel}
              sublabel={activating ? undefined : ctaSub}
              onPress={() => void buy()}
              loading={busy && !activating}
              disabled={activating}
            />
          )}

          <Text style={styles.fine}>
            {credits.isPro ? 'Manage or cancel any time in your store settings.' : 'Cancel anytime. Renews automatically until you cancel.'}
          </Text>
          <View style={styles.links}>
            {credits.isPro ? null : (
              <>
                <Text style={styles.link} onPress={() => void restore()} accessibilityRole="button">
                  Restore purchases
                </Text>
                <Text style={styles.dot}>·</Text>
              </>
            )}
            <Text style={styles.link} onPress={() => void Linking.openURL(TERMS_URL)} accessibilityRole="link">
              Terms of Use
            </Text>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

/** The store's packages when it has answered; `DISPLAY_PRICES` until then. */
function displayPlans(offers: PlanOffer[]): Record<PlanKey, DisplayPlan> {
  const annual = offers.find((o) => o.packageType === 'ANNUAL');
  const monthly = offers.find((o) => o.packageType === 'MONTHLY');
  const fallbackPerMonth = `$${(DISPLAY_PRICES.annual.price / 12).toFixed(2)}`;
  return {
    annual: annual
      ? {
          key: 'annual',
          title: 'Yearly',
          price: annual.price,
          priceAmount: annual.priceAmount,
          perMonth: annual.pricePerMonth ?? fallbackPerMonth,
          trialDays: annual.freeTrialDays,
          offer: annual,
        }
      : {
          key: 'annual',
          title: 'Yearly',
          price: DISPLAY_PRICES.annual.label,
          priceAmount: DISPLAY_PRICES.annual.price,
          perMonth: fallbackPerMonth,
          trialDays: 0,
        },
    monthly: monthly
      ? {
          key: 'monthly',
          title: 'Monthly',
          price: monthly.price,
          priceAmount: monthly.priceAmount,
          perMonth: monthly.price,
          trialDays: monthly.freeTrialDays,
          offer: monthly,
        }
      : {
          key: 'monthly',
          title: 'Monthly',
          price: DISPLAY_PRICES.monthly.label,
          priceAmount: DISPLAY_PRICES.monthly.price,
          perMonth: DISPLAY_PRICES.monthly.label,
          trialDays: 0,
        },
  };
}

function Feature({
  icon,
  title,
  free,
  pro,
  note,
  delay,
  enter,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  free?: number;
  pro?: number;
  note?: string;
  delay: number;
  enter: (delay: number) => EnteringAnimation;
}) {
  const c = usePaywallColors();
  const styles = useStyles();
  return (
    <Animated.View entering={enter(delay)} style={styles.feature}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={16} color={c.violetText} />
      </View>
      <Text style={styles.featureTitle}>{title}</Text>
      {note ? (
        <Text style={styles.featureNote}>{note}</Text>
      ) : (
        <View style={styles.compare}>
          <Text style={styles.compareFree}>{free}</Text>
          <Ionicons name="arrow-forward" size={11} color={c.textTertiary} />
          <Text style={styles.comparePro}>{pro}</Text>
        </View>
      )}
    </Animated.View>
  );
}

/**
 * Pro just switched on: confetti, a badge that lands with a thud, and one button out.
 * The haptic fired with the state change, in the same frame the confetti starts.
 */
function Celebration({ dailyGrant, onDone }: { dailyGrant: number; onDone: () => void }) {
  const c = usePaywallColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const badge = useSharedValue(reduced ? 1 : 0.6);

  useEffect(() => {
    if (!reduced) badge.set(withDelay(120, withSpring(1, { duration: 600, dampingRatio: 0.5 })));
  }, [reduced, badge]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.get() }] }));

  return (
    <View style={styles.screen}>
      <StatusBar style={c.statusBar} />
      <AuroraBackground />
      <Confetti />
      <SafeAreaView style={[styles.safe, styles.celebration]} edges={['top', 'bottom']}>
        <Animated.View entering={FadeIn.duration(250)}>
          <Animated.View style={[styles.celebrationBadge, badgeStyle]}>
            <Ionicons name="sparkles" size={44} color="#FFFFFF" />
          </Animated.View>
        </Animated.View>
        <Animated.Text entering={FadeInDown.duration(450).delay(250)} style={[styles.title, styles.center]}>
          Welcome to Pro
        </Animated.Text>
        <Animated.Text entering={FadeInDown.duration(450).delay(350)} style={[styles.lede, styles.center]}>
          {dailyGrant} Auto Applies a day, starting right now.
        </Animated.Text>
        <Animated.View entering={FadeInDown.duration(450).delay(500)} style={styles.celebrationCta}>
          <ShimmerButton label="Let’s go" onPress={onDone} />
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function statusLine(sub: { status: string; periodEnd: string | null; autoRenew: boolean | null } | null): string {
  if (!sub) return 'Thanks for supporting CareerDeck.';
  const end = sub.periodEnd ? new Date(sub.periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  if (sub.status === 'grace') return 'There’s a problem with your payment. Update it in your store account to keep Pro.';
  if (!end) return 'Thanks for supporting CareerDeck.';
  return sub.autoRenew ? `Renews ${end}.` : `Pro stays on until ${end}, then you’re back on Free.`;
}

const useStyles = makePaywallStyles((c) => ({
  screen: {
    flex: 1,
    backgroundColor: c.background,
  },
  safe: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 16,
    alignItems: 'flex-end',
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.glassStrong,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  proPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: c.gold,
    marginTop: -6,
  },
  proPillText: {
    color: '#1A1300',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: {
    color: c.text,
    fontSize: 32,
    lineHeight: 37,
    fontWeight: '800',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  lede: {
    color: c.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: -6,
  },
  features: {
    gap: 10,
    paddingVertical: 4,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.tintSoft,
  },
  featureTitle: {
    flex: 1,
    color: c.text,
    fontSize: 15,
    fontWeight: '600',
  },
  featureNote: {
    color: c.success,
    fontSize: 13,
    fontWeight: '700',
  },
  compare: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compareFree: {
    color: c.textTertiary,
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  comparePro: {
    color: c.violetText,
    fontSize: 17,
    fontWeight: '900',
  },
  plans: {
    gap: 14,
    marginTop: 8,
  },
  footnote: {
    color: c.textTertiary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  bottom: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
    backgroundColor: c.bottomBar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.hairline,
  },
  message: {
    color: c.text,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  preview: {
    color: c.violetText,
    fontSize: 12,
    textAlign: 'center',
  },
  fine: {
    color: c.textTertiary,
    fontSize: 12,
    textAlign: 'center',
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  link: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  dot: {
    color: c.textTertiary,
    fontSize: 12,
  },
  celebration: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  celebrationBadge: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.violet,
    shadowColor: c.magenta,
    shadowOpacity: 0.9,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  center: {
    textAlign: 'center',
  },
  celebrationCta: {
    alignSelf: 'stretch',
    marginTop: 12,
  },
}));
