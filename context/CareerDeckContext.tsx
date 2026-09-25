import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AUTO_APPLY_ECONOMY, DEFAULT_WEEKLY_GOAL, MAX_WEEKLY_GOAL, MIN_WEEKLY_GOAL } from '@/constants/goal';
import { useAuth } from '@/context/AuthContext';
import { useApplicationRecords } from '@/hooks/useApplicationRecords';
import { useNotifications } from '@/hooks/useNotifications';
import { useProfile } from '@/hooks/useProfile';
import { useViewerState } from '@/hooks/useViewerState';
import { setImpressionsEnabled } from '@/lib/impressions';
import { setOutboxUser } from '@/lib/outbox';
import type {
  AppNotification,
  Application,
  ApplicationStatus,
  User,
  UserIdentityEdit,
} from '@/types';

/**
 * Session and viewer state for CareerDeck.
 *
 * Phase 0 moved identity and preferences onto Postgres. Phase 1 took the corpus away
 * entirely — `jobs` and `companies` are read a page at a time through `lib/api.ts`.
 * Phase 2 takes the last of the durable state: likes, saves, follows and the application
 * tracker are rows now, read by `useViewerState` and `useApplicationRecords`, written
 * optimistically and queued through `lib/outbox.ts`.
 *
 * Phase 3 takes comments and the notification inbox. Comments were never really state this
 * file could hold — they are per-posting, paginated and moderated — so rather than becoming a
 * set of context fields they moved out entirely, into `useJobComments` / `useCommentActions`
 * called by the sheet that needs them. The inbox did become a field, because the tab bar's
 * unread badge needs it and the tab bar is nowhere near Activity.
 *
 * What is left in this file is what Appendix A says should be left — "the existing context,
 * slimmed to hold only session/viewer state" — plus the two things later phases own and that
 * therefore still live in memory:
 *
 *  - **Auto Apply credits** (phase 6's `credit_transactions` ledger).
 *
 * It is a fixture behind a real-looking interface, and it becomes a hook of its own the way
 * applications and comments did. Nothing above this file knows the difference, which is the
 * point of the facade.
 *
 * **Resumes were the other one, and phase 4 collected on the prediction.** `resumes`,
 * `defaultResumeId` and `setDefaultResume` are gone from here into `hooks/useResumes.ts`,
 * reading the `resumes` table and a private storage bucket. `defaultResumeId` is the one worth
 * noting: it was a `useState` seeded from a fixture, which made "exactly one default" true for
 * as long as the last render said so. It is now a partial unique index. §3.9.
 */

interface CareerDeckState {
  /**
   * True until the signed-in user's profile, viewer sets and tracker have all landed.
   *
   * All three, not just the profile: a toggle tapped before the viewer sets arrive has
   * nothing to toggle *against*, and the Following feed would render empty for a moment
   * to someone who follows twenty companies. The app shell waits on this, so the window
   * never exists.
   */
  isInitialLoading: boolean;
  /** Null while the profile is loading, or if it failed to load. */
  user: User | null;
  /** Set when the profile could not be read — the app shell can't be trusted until it is. */
  profileError: Error | null;
  retryProfile: () => void;
  /** The user's tracked applications, newest activity first. */
  applications: Application[];
  /**
   * Replies, likes, moderation notices and verification notices — newest first. §3.8.
   *
   * Held here rather than read by Activity alone because the tab bar's unread badge needs the
   * count, and the tab bar is not on the Activity screen.
   */
  notifications: AppNotification[];
  unreadNotificationCount: number;
  /**
   * Company **slugs**, from `company_follows` by way of `viewer_state()`. The join keys on
   * the company uuid; the slug is what comes back out, because it is what the Following
   * feed filters on and what every route segment carries. §1.3(c).
   */
  followedCompanySlugs: string[];
  likedJobIds: string[];
  savedJobIds: string[];
  /** News items the user has already watched in the stories row. */
  seenNewsIds: string[];
  isFollowing: (companySlug: string) => boolean;
  toggleFollow: (companySlug: string) => void;
  toggleLike: (jobId: string) => void;
  toggleSave: (jobId: string) => void;
  /** One-way: a story that has been watched stays watched for the session. */
  markNewsSeen: (newsId: string) => void;
  /** Moves an application to a new stage. The event row is written by a trigger. */
  setApplicationStatus: (applicationId: string, status: ApplicationStatus) => void;
  /**
   * Records that the user applied to a job. Called after they come back from the
   * employer's site and confirm it — nothing here can observe a real submission.
   */
  logApplication: (jobId: string, source: Application['source']) => void;
  /** Whether this job is already in the tracker, so Apply can read "Applied" instead. */
  hasApplied: (jobId: string) => boolean;
  /**
   * Whether the viewer has liked a comment — §1.3(b)'s `viewerHasLiked`, which travels apart
   * from the comment's stored count. Posting, deleting, reporting and blocking are *not* here:
   * they belong to the sheet that does them, through `useCommentActions`.
   */
  isCommentLiked: (commentId: string) => boolean;
  toggleCommentLike: (commentId: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  /** Applications the user is aiming to send each week. Set by them, not by us. */
  weeklyGoal: number;
  /** Clamped to the picker's range — a goal of zero would make the ring meaningless. */
  setWeeklyGoal: (target: number) => void;
  /** Auto Applies available to spend right now. */
  autoApplyCredits: number;
  /**
   * Spends one. Returns false when the balance is empty so the caller can say so
   * rather than silently doing nothing.
   */
  spendAutoApplyCredit: () => boolean;
  /**
   * Pays the bonus for a week that reached the goal, at most once per week. Returns
   * what was actually added, which is zero for a week already paid or a full bank.
   */
  awardStreakBonus: (weekKey: string, amount: number) => number;
  /**
   * Receipt for the most recent bonus — what was paid, and for which week. Kept here
   * rather than recomputed by the card, because a full bank can pay less than a week
   * was worth and only the ledger knows the difference.
   */
  lastStreakAward: StreakAward | null;

  /** Roles the user is looking for. Shown and edited on Profile. */
  preferredRoles: string[];
  /** Where they'd take a job — "Remote" counts as a location here. */
  preferredLocations: string[];
  setPreferredRoles: (roles: string[]) => void;
  setPreferredLocations: (locations: string[]) => void;
  /**
   * Updates the identity fields. `displayName` is derived from the names rather than
   * edited, so there's only ever one spelling of who this is.
   */
  updateIdentity: (edit: UserIdentityEdit) => void;
}

export interface StreakAward {
  weekKey: string;
  amount: number;
}

const CareerDeckContext = createContext<CareerDeckState | null>(null);

export function CareerDeckProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const {
    profile,
    isLoading: isProfileLoading,
    error: profileError,
    retry: retryProfile,
    updateIdentity: writeIdentity,
    updatePreferences,
  } = useProfile(userId);

  const viewer = useViewerState(userId);
  const tracker = useApplicationRecords(userId);
  const inbox = useNotifications(userId);

  /*
   * The two module-level singletons that need to know who is signed in.
   *
   * The outbox refuses to send anything under a session that did not queue it, and the
   * impression buffer refuses to collect at all without one. Both are modules rather than
   * hooks because they outlive every component — the outbox drains on app foreground, and
   * impressions flush on backgrounding, neither of which is a render.
   */
  useEffect(() => {
    setOutboxUser(userId);
    setImpressionsEnabled(userId !== null);
  }, [userId]);

  const [seenNewsIds, setSeenNewsIds] = useState<Set<string>>(() => new Set<string>());
  // Seeded with a single day's grant. Accrual across days, and the balance surviving a
  // restart, both need the credit ledger in §7, which phase 6 builds.
  const [autoApplyCredits, setAutoApplyCredits] = useState<number>(AUTO_APPLY_ECONOMY.dailyGrant);
  /**
   * The balance again, readable synchronously. Spending and awarding both need to
   * report what happened to their caller, and a state setter's callback can't be read
   * back in time to answer that.
   */
  const creditsRef = useRef(autoApplyCredits);
  /** Week keys already paid, so a re-render or a tab revisit can't pay twice. */
  const paidWeeks = useRef<Set<string>>(new Set());
  const [lastStreakAward, setLastStreakAward] = useState<StreakAward | null>(null);

  const user = profile?.user ?? null;
  const weeklyGoal = profile?.weeklyGoal ?? DEFAULT_WEEKLY_GOAL;
  /*
   * The inbox is deliberately *not* in here.
   *
   * The shell waits on this before it renders anything, and the three reads it does wait on are
   * ones the first frame is wrong without: who you are, what you have saved, what you have
   * applied to. A notification badge that appears a moment later is correct behaviour; a splash
   * screen held open for it is not.
   */
  const isInitialLoading = isProfileLoading || viewer.isLoading || tracker.isLoading;

  const setCredits = useCallback((next: number) => {
    creditsRef.current = next;
    setAutoApplyCredits(next);
  }, []);
  // Returning the same Set when nothing changes matters here: this fires from an effect
  // on every story frame, and a fresh Set each time would re-render the whole tree.
  const markNewsSeen = useCallback((newsId: string) => {
    setSeenNewsIds((current) => (current.has(newsId) ? current : new Set(current).add(newsId)));
  }, []);

  const setWeeklyGoal = useCallback(
    (target: number) => {
      // Clamped here as well as by the check constraint on user_preferences.weekly_goal:
      // the database is what makes it true, this is what stops a round trip that can
      // only come back as an error.
      updatePreferences({
        weeklyGoal: Math.min(Math.max(Math.round(target), MIN_WEEKLY_GOAL), MAX_WEEKLY_GOAL),
      });
    },
    [updatePreferences],
  );

  const spendAutoApplyCredit = useCallback(() => {
    if (creditsRef.current <= 0) return false;
    setCredits(creditsRef.current - 1);
    return true;
  }, [setCredits]);

  const awardStreakBonus = useCallback(
    (weekKey: string, amount: number) => {
      if (amount <= 0 || paidWeeks.current.has(weekKey)) return 0;
      paidWeeks.current.add(weekKey);

      const next = Math.min(creditsRef.current + amount, AUTO_APPLY_ECONOMY.bankCap);
      const awarded = next - creditsRef.current;
      if (awarded > 0) setCredits(next);
      setLastStreakAward({ weekKey, amount: awarded });
      return awarded;
    },
    [setCredits],
  );

  const setPreferredRoles = useCallback(
    (roles: string[]) => updatePreferences({ preferredRoles: roles }),
    [updatePreferences],
  );

  const setPreferredLocations = useCallback(
    (locations: string[]) => updatePreferences({ preferredLocations: locations }),
    [updatePreferences],
  );

  // `displayName` isn't sent: it's a generated column on `profiles`, composed from the
  // two name fields, so there is only ever one spelling of who this is.
  const updateIdentity = useCallback((edit: UserIdentityEdit) => writeIdentity(edit), [writeIdentity]);

  const value = useMemo<CareerDeckState>(() => {
    return {
      isInitialLoading,
      user,
      profileError,
      retryProfile,
      applications: tracker.applications,
      /*
       * §1.3(b), closed.
       *
       * Phase 2 folded the viewer's own like into `likeCount` here and left a note that the fix
       * and phase 3 would land together, because there was no stored count for the fix to be
       * about. There is now: `comments.like_count` is the true total, maintained by a trigger, and
       * the viewer's own like arrives in `viewer_state()` alongside their saves and follows. So
       * this no longer adds one to anything — it hands out the predicate instead, and the row
       * renders a filled heart from that.
       */
      notifications: inbox.notifications,
      unreadNotificationCount: inbox.unreadCount,
      followedCompanySlugs: viewer.followedCompanySlugs,
      likedJobIds: viewer.likedJobIds,
      savedJobIds: viewer.savedJobIds,
      seenNewsIds: [...seenNewsIds],
      isFollowing: viewer.isFollowing,
      toggleFollow: viewer.toggleFollow,
      toggleLike: viewer.toggleLike,
      toggleSave: viewer.toggleSave,
      markNewsSeen,
      setApplicationStatus: tracker.setApplicationStatus,
      logApplication: tracker.logApplication,
      hasApplied: tracker.hasApplied,
      isCommentLiked: viewer.isCommentLiked,
      toggleCommentLike: viewer.toggleCommentLike,
      markNotificationRead: inbox.markRead,
      markAllNotificationsRead: inbox.markAllRead,
      weeklyGoal,
      setWeeklyGoal,
      autoApplyCredits,
      spendAutoApplyCredit,
      awardStreakBonus,
      lastStreakAward,
      preferredRoles: user?.preferredRoles ?? [],
      preferredLocations: user?.preferredLocations ?? [],
      setPreferredRoles,
      setPreferredLocations,
      updateIdentity,
    };
  }, [
    isInitialLoading,
    profileError,
    retryProfile,
    viewer.followedCompanySlugs,
    viewer.likedJobIds,
    viewer.savedJobIds,
    viewer.isFollowing,
    viewer.toggleFollow,
    viewer.toggleLike,
    viewer.toggleSave,
    seenNewsIds,
    tracker.applications,
    tracker.setApplicationStatus,
    tracker.logApplication,
    tracker.hasApplied,
    inbox.notifications,
    inbox.unreadCount,
    inbox.markRead,
    inbox.markAllRead,
    viewer.isCommentLiked,
    viewer.toggleCommentLike,
    markNewsSeen,
    weeklyGoal,
    setWeeklyGoal,
    autoApplyCredits,
    spendAutoApplyCredit,
    awardStreakBonus,
    lastStreakAward,
    user,
    setPreferredRoles,
    setPreferredLocations,
    updateIdentity,
  ]);

  return <CareerDeckContext.Provider value={value}>{children}</CareerDeckContext.Provider>;
}

export function useCareerDeck(): CareerDeckState {
  const context = useContext(CareerDeckContext);
  if (!context) {
    throw new Error('useCareerDeck must be used inside a <CareerDeckProvider>.');
  }
  return context;
}
