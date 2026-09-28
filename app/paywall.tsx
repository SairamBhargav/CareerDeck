import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { fetchCredits, fetchPlans, fetchSubscription, type Plan } from '@/lib/api';
import {
  fetchOffers,
  isBillingConfigured,
  isPreviewMode,
  purchase,
  restorePurchases,
  type PlanOffer,
} from '@/lib/billing';
import { reportError } from '@/lib/observability';

/** How long to wait for RevenueCat's webhook to land after a purchase before saying so. */
const ACTIVATION_TIMEOUT_MS = 30_000;
const ACTIVATION_POLL_MS = 2_000;

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

/**
 * The paywall — §8, the one screen in the app that sells anything.
 *
 * Three rules from §8 decide what is on it:
 *
 *  - **The free tier is genuinely useful**, so the comparison leads with what free already
 *    includes. Nobody is told they need Pro to use CareerDeck, because they do not.
 *  - **Entitlements come from webhooks.** A completed purchase does not flip anything here.
 *    The screen waits for `my_credits()` to report the new plan — which only happens once
 *    `apply_revenuecat_event()` has written it — and says "activating" until then.
 *  - **The numbers are the server's.** Both columns read the `plans` table the gates read, so
 *    the paywall cannot promise a number the database does not enforce.
 */
export default function PaywallScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
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

  const [busyOffer, setBusyOffer] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const free = plans.data?.find((p) => p.id === 'free');
  const pro = plans.data?.find((p) => p.id === 'pro');

  /*
   * The plan the rest of the app reads is `credits`, so once the wait sees Pro it refreshes that
   * one query and the shelf, the Auto Apply button and Settings all change together.
   */
  const activate = async () => {
    setActivating(true);
    const active = await waitForPaidPlan();
    await credits.refresh();
    setActivating(false);
    setMessage(
      active
        ? 'You’re on Pro. Your extra Auto Applies are ready.'
        : 'Your purchase went through, and it’s taking longer than usual to activate. It will switch on by itself — you don’t need to buy again.',
    );
  };

  const buy = async (offer: PlanOffer) => {
    setBusyOffer(offer.id);
    setMessage(null);
    try {
      const outcome = await purchase(offer);
      if (outcome === 'purchased') await activate();
    } catch (error) {
      reportError(error, { where: 'paywall.purchase' });
      setMessage(error instanceof Error ? error.message : 'The purchase did not go through.');
    } finally {
      setBusyOffer(null);
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

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <IconButton name="close" onPress={() => router.back()} accessibilityLabel="Close" />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Ionicons name="sparkles" size={28} color={colors.autoApply} />
        <Text style={styles.title}>{credits.isPro ? 'You’re on Pro' : 'CareerDeck Pro'}</Text>
        <Text style={styles.lede}>
          {credits.isPro
            ? statusLine(subscription.data ?? null)
            : 'More Auto Applies for the weeks you’re applying hard. Everything else stays free.'}
        </Text>

        {free && pro ? <Comparison free={free} pro={pro} /> : null}

        <Text style={styles.footnote}>
          Free always includes the feed, saving, following, the tracker and your daily Auto Apply.
          If Pro lapses you keep every application, resume and credit you have.
        </Text>

        {message ? <Text style={styles.message}>{message}</Text> : null}

        {credits.isPro ? (
          <PrimaryButton label="Manage subscription" variant="secondary" onPress={manage} />
        ) : !isBillingConfigured() ? (
          <Text style={styles.message}>Subscriptions aren’t available on this build yet.</Text>
        ) : (
          <View style={styles.offers}>
            {isPreviewMode() ? (
              <Text style={styles.preview}>
                Running in Expo Go: purchases here are simulated and won’t activate Pro. A
                development build is needed to buy for real.
              </Text>
            ) : null}

            {offers.isLoading ? <Text style={styles.footnote}>Loading prices…</Text> : null}
            {offers.data?.length === 0 ? (
              <Text style={styles.footnote}>No plans are on sale right now.</Text>
            ) : null}

            {offers.data?.map((offer) => (
              <PrimaryButton
                key={offer.id}
                label={`${offer.label} · ${offer.price}`}
                onPress={() => void buy(offer)}
                loading={busyOffer === offer.id}
                disabled={busyOffer !== null || activating}
              />
            ))}

            {activating ? <Text style={styles.footnote}>Activating Pro…</Text> : null}

            <PrimaryButton label="Restore purchases" variant="ghost" onPress={() => void restore()} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusLine(sub: { status: string; periodEnd: string | null; autoRenew: boolean | null } | null): string {
  if (!sub) return 'Thanks for supporting CareerDeck.';
  const end = sub.periodEnd ? new Date(sub.periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  if (sub.status === 'grace') return 'There’s a problem with your payment. Update it in your store account to keep Pro.';
  if (!end) return 'Thanks for supporting CareerDeck.';
  return sub.autoRenew ? `Renews ${end}.` : `Pro stays on until ${end}, then you’re back on Free.`;
}

function Comparison({ free, pro }: { free: Plan; pro: Plan }) {
  const styles = useStyles();
  const rows: { label: string; free: string; pro: string }[] = [
    { label: 'Auto Applies a day', free: String(free.dailyGrant), pro: String(pro.dailyGrant) },
    { label: 'Auto Applies banked', free: String(free.bankCap), pro: String(pro.bankCap) },
    { label: 'Resumes on your shelf', free: String(free.resumeLimit), pro: String(pro.resumeLimit) },
  ];

  return (
    <View style={styles.table}>
      <View style={styles.row}>
        <Text style={[styles.cellLabel, styles.headCell]} />
        <Text style={[styles.cell, styles.headCell]}>Free</Text>
        <Text style={[styles.cell, styles.headCell, styles.proCell]}>Pro</Text>
      </View>
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.cellLabel}>{row.label}</Text>
          <Text style={styles.cell}>{row.free}</Text>
          <Text style={[styles.cell, styles.proCell]}>{row.pro}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    paddingHorizontal: screenPadding,
    alignItems: 'flex-end',
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.8,
  },
  lede: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  table: {
    backgroundColor: colors.backgroundMuted,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  cellLabel: {
    flex: 1,
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  cell: {
    width: 56,
    textAlign: 'center',
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  headCell: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  proCell: {
    color: colors.autoApply,
  },
  footnote: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textTertiary,
  },
  message: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.text,
  },
  preview: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.autoApply,
  },
  offers: {
    gap: spacing.sm,
  },
}));
