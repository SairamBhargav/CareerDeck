/**
 * What Pro costs, for display only.
 *
 * The prices people actually pay come from the App Store and Play products through RevenueCat
 * (`lib/billing.ts`), and the paywall always shows those once the store answers. These are what
 * it shows before then, and on a build with no store keys, so the screen never renders blank.
 * Keep them equal to the store products, or the price will jump once the store loads.
 *
 * Priced to cover cost, not to profit (2026-10-06). An Auto Apply draft is ~$0.011 on Sonnet 5
 * and a resume parse ~$0.04. A subscriber who uses all 5 a day, every day, costs ~$1.65 a month.
 * After the stores' 15% small-business cut, $2.99 a month nets $2.54 and $24.99 a year nets
 * $21.24, which covers even that ceiling (~$20 a year).
 */
export const DISPLAY_PRICES = {
  monthly: { price: 2.99, label: '$2.99' },
  annual: { price: 24.99, label: '$24.99' },
} as const;

/** "Save 30%" on the annual plan, from two prices in the same currency. */
export function annualSavingsPercent(monthly: number, annual: number): number {
  if (monthly <= 0 || annual <= 0) return 0;
  return Math.max(0, Math.round((1 - annual / (monthly * 12)) * 100));
}
