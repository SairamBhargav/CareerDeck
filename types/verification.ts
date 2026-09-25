/**
 * README §3.2's tier ladder, as the client sees it.
 *
 * | Tier | How you get it | Unlocks |
 * |---|---|---|
 * | `none` | — | Nothing; pre-signup only |
 * | `email` | Confirm any email | Everything except commenting |
 * | `edu` | A code sent to an address matching a registered school | Commenting + the `CS @ Purdue '27` badge |
 * | `identity` | Pass a vendor personhood check | Commenting + a generic "Verified" badge |
 *
 * `edu` and `identity` are **siblings, not a hierarchy**. Both grant comment-write and they differ
 * only in the badge. Any UI built on this type has to reflect that: offering the ID path only as a
 * fallback after the `.edu` path fails would strand the bootcamp grad, the career switcher and the
 * student whose university uses a `.ac.uk`-style domain, which is exactly who the second path
 * exists for.
 */
export type VerificationTier = 'none' | 'email' | 'edu' | 'identity';

export interface VerificationState {
  tier: VerificationTier;
  /** True for `edu` or `identity` — the two tiers that open the composer. */
  canComment: boolean;
  /** `CS @ Purdue '27`, or null on the ID path, which claims no school. */
  badge: string | null;
  /** The pseudonym comments will carry. Generated at signup; the user never picks it. */
  handle: string | null;
  /**
   * When the `.edu` address needs re-confirming. §3.2 re-challenges these after about two years,
   * because an address that outlives its student is the one credential here that decays on its own.
   */
  eduExpiresAt: string | null;
  /** Set while a code has been sent and not yet used. */
  pendingEduEmail: string | null;
}

/** What `POST /v1/verify/edu/start` answers. */
export interface EduChallenge {
  /** "Purdue" — named back so the user knows the address was recognised. */
  school: string;
  expiresInMinutes: number;
  /** False when the server has no mail provider, which only happens outside production. */
  delivered: boolean;
  /**
   * The code itself, returned **only** by a development server with no mail provider configured,
   * so the flow is testable on a fresh clone. A production server refuses that path outright
   * rather than returning this.
   */
  devCode?: string;
}
