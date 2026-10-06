/**
 * The third seam — the one that talks to the app stores, through RevenueCat. §8.
 *
 * `lib/api.ts` talks to Postgres and `lib/service.ts` talks to `server/`. This file talks to
 * RevenueCat's SDK, and it is the only file that does, for the same reason the other two exist:
 * the rest of the app should not know how a thing is fetched, only that it can be.
 *
 * ── What this file can and cannot do ──────────────────────────────────────────
 *
 * It can show what is for sale and start a purchase. It **cannot** grant anything. A completed
 * purchase changes nothing in this app directly: the store tells RevenueCat, RevenueCat calls
 * `server/`'s webhook, and `apply_revenuecat_event()` writes the entitlement. The client then
 * notices by re-reading its plan (`my_credits()`), which is the only answer it trusts. §8's
 * "never from a client claim", enforced by there being no client write to make the claim with.
 *
 * ── Expo Go ───────────────────────────────────────────────────────────────────
 *
 * `react-native-purchases` detects Expo Go and swaps its native calls for a JavaScript
 * **Preview API mode**: offerings and purchase sheets are mocks, and no purchase is real —
 * so no webhook ever arrives and the plan never changes. That is correct, and it is why the
 * paywall says so when `isPreviewMode()` is true. Real sandbox purchases need a development
 * build. PHASE6.md §4.3.
 */

import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { isExpoGo } from 'react-native-purchases/dist/utils/environment';

import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from '@/lib/env';
import { reportError } from '@/lib/observability';

const apiKey = Platform.select({ ios: REVENUECAT_IOS_KEY, android: REVENUECAT_ANDROID_KEY });

let configured = false;
let loggedInAs: string | null = null;

/** Whether this build can sell anything at all. */
export function isBillingConfigured(): boolean {
  return apiKey !== undefined && Platform.OS !== 'web';
}

/** True in Expo Go, where purchases are mocked and can never reach the webhook. */
export function isPreviewMode(): boolean {
  try {
    return isExpoGo();
  } catch {
    return false;
  }
}

function ensureConfigured(): boolean {
  if (!isBillingConfigured()) return false;
  if (!configured) {
    Purchases.configure({ apiKey: apiKey! });
    configured = true;
  }
  return true;
}

/**
 * Ties RevenueCat's customer to the Supabase account, so the webhook's `app_user_id` is the
 * user id `apply_revenuecat_event()` resolves. Called whenever the signed-in account changes.
 *
 * Never throws. A failed login leaves purchases filed under an anonymous id, which the webhook
 * still resolves through `aliases` once RevenueCat links them — worse, not broken.
 */
export async function setBillingUser(userId: string | null): Promise<void> {
  if (!ensureConfigured() || userId === loggedInAs) return;

  try {
    if (userId) {
      await Purchases.logIn(userId);
    } else if (loggedInAs) {
      await Purchases.logOut();
    }
    loggedInAs = userId;
  } catch (error) {
    reportError(error, { where: 'billing.setBillingUser' });
  }
}

export interface PlanOffer {
  id: string;
  /** "Monthly", "Annual" — RevenueCat's package type, humanised. */
  label: string;
  /** RevenueCat's package type: "MONTHLY", "ANNUAL", … */
  packageType: string;
  price: string;
  /** The same price as a number, in `currencyCode`, for working out a saving. */
  priceAmount: number;
  /** "$2.08" for an annual plan; null where the store cannot say. */
  pricePerMonth: string | null;
  /** Length of a free introductory trial, in days. 0 when the product has none. */
  freeTrialDays: number;
  period: string | null;
  pkg: PurchasesPackage;
}

const DAYS_PER_UNIT: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

function freeTrialDays(pkg: PurchasesPackage): number {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return 0;
  return (DAYS_PER_UNIT[String(intro.periodUnit)] ?? 0) * intro.periodNumberOfUnits * Math.max(1, intro.cycles);
}

const LABEL: Record<string, string> = {
  MONTHLY: 'Monthly',
  ANNUAL: 'Annual',
  SIX_MONTH: '6 months',
  THREE_MONTH: '3 months',
  TWO_MONTH: '2 months',
  WEEKLY: 'Weekly',
  LIFETIME: 'Lifetime',
};

/** What the current offering sells. Empty when nothing is configured or the store is unreachable. */
export async function fetchOffers(): Promise<PlanOffer[]> {
  if (!ensureConfigured()) return [];

  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];

  return packages.map((pkg) => ({
    id: pkg.identifier,
    label: LABEL[String(pkg.packageType)] ?? pkg.product.title,
    packageType: String(pkg.packageType),
    price: pkg.product.priceString,
    priceAmount: pkg.product.price,
    pricePerMonth: pkg.product.pricePerMonthString,
    freeTrialDays: freeTrialDays(pkg),
    period: pkg.product.subscriptionPeriod ?? null,
    pkg,
  }));
}

export type PurchaseOutcome = 'purchased' | 'cancelled';

/**
 * Runs the store's purchase sheet. Resolves `cancelled` when the reader backed out, which is
 * not an error and must not be reported as one.
 */
export async function purchase(offer: PlanOffer): Promise<PurchaseOutcome> {
  if (!ensureConfigured()) throw new Error('Subscriptions are not available on this build.');

  try {
    await Purchases.purchasePackage(offer.pkg);
    return 'purchased';
  } catch (error) {
    if ((error as { userCancelled?: boolean | null }).userCancelled) return 'cancelled';
    throw error;
  }
}

/** Re-links an existing store subscription to this account — the App Store's required button. */
export async function restorePurchases(): Promise<void> {
  if (!ensureConfigured()) throw new Error('Subscriptions are not available on this build.');
  await Purchases.restorePurchases();
}
