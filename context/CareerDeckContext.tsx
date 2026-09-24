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
import { mockCommentActivity } from '@/data/mockCommentActivity';
import { mockComments } from '@/data/mockComments';
import { defaultResumeId as seedDefaultResumeId, mockResumes } from '@/data/mockResumes';
import { useApplicationRecords } from '@/hooks/useApplicationRecords';
import { useProfile } from '@/hooks/useProfile';
import { useViewerState } from '@/hooks/useViewerState';
import { setImpressionsEnabled } from '@/lib/impressions';
import { setOutboxUser } from '@/lib/outbox';
import type {
  Application,
  ApplicationStatus,
  CommentActivity,
  JobComment,
  Resume,
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
 * What is left in this file is what Appendix A says should be left — "the existing
 * context, slimmed to hold only session/viewer state" — plus the three things later
 * phases own and that therefore still live in memory:
 *
 *  - **Comments and comment activity** (phase 3's `comments`, `notifications`).
 *  - **Resumes** (phase 4's storage bucket and `resumes` table).
 *  - **Auto Apply credits** (phase 6's `credit_transactions` ledger).
 *
 * Each of those is a fixture behind a real-looking interface, and each becomes a hook of
 * its own the way applications just did. Nothing above this file knows the difference,
 * which is the point of the facade.
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
  resumes: Resume[];
  defaultResumeId: string;
  /** The user's tracked applications, newest activity first. */
  applications: Application[];
  /** Every comment on every posting, with the viewer's own likes already applied. */
  comments: JobComment[];
  /** Replies and likes on the user's own comments, newest first. */
  commentActivity: CommentActivity[];
  unreadCommentCount: number;
  /** The resume currently used to pre-fill the apply sheet. */
  defaultResume: Resume | undefined;
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
  setDefaultResume: (resumeId: string) => void;
  /** Moves an application to a new stage. The event row is written by a trigger. */
  setApplicationStatus: (applicationId: string, status: ApplicationStatus) => void;
  /**
   * Records that the user applied to a job. Called after they come back from the
   * employer's site and confirm it — nothing here can observe a real submission.
   */
  logApplication: (jobId: string, source: Application['source']) => void;
  /** Whether this job is already in the tracker, so Apply can read "Applied" instead. */
  hasApplied: (jobId: string) => boolean;
  likedCommentIds: string[];
  toggleCommentLike: (commentId: string) => void;
  /**
   * Posts on a job's thread. `parentId` is the top-level comment being answered, or
   * null for a new thread — replies never nest further, see JobComment.
   */
  addComment: (jobId: string, body: string, parentId: string | null, gifId?: string) => void;
  /** Removes a comment and anything replying to it — an orphaned reply reads as a non sequitur. */
  deleteComment: (commentId: string) => void;
  markCommentActivityRead: (activityId: string) => void;
  markAllCommentActivityRead: () => void;

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

function toggleInSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

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
  const [defaultResumeId, setDefaultResumeId] = useState(seedDefaultResumeId);
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
  const isInitialLoading = isProfileLoading || viewer.isLoading || tracker.isLoading;

  const setCredits = useCallback((next: number) => {
    creditsRef.current = next;
    setAutoApplyCredits(next);
  }, []);
  const [commentActivity, setCommentActivity] = useState<CommentActivity[]>(mockCommentActivity);
  const [comments, setComments] = useState<JobComment[]>(mockComments);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(() => new Set<string>());

  // Returning the same Set when nothing changes matters here: this fires from an effect
  // on every story frame, and a fresh Set each time would re-render the whole tree.
  const markNewsSeen = useCallback((newsId: string) => {
    setSeenNewsIds((current) => (current.has(newsId) ? current : new Set(current).add(newsId)));
  }, []);

  const setDefaultResume = useCallback((resumeId: string) => {
    setDefaultResumeId(resumeId);
  }, []);

  const toggleCommentLike = useCallback((commentId: string) => {
    setLikedCommentIds((current) => toggleInSet(current, commentId));
  }, []);

  const addComment = useCallback((jobId: string, body: string, parentId: string | null, gifId?: string) => {
    const trimmed = body.trim();
    // A GIF on its own is a comment; text on its own is a comment; neither is not.
    if (trimmed.length === 0 && gifId === undefined) return;
    // No profile means no author to attribute it to. Unreachable from the UI — the
    // thread is behind the auth gate — but a comment signed by nobody is worse than one
    // that doesn't get posted.
    if (!user) return;

    setComments((current) => [
      ...current,
      {
        id: `c-local-${Date.now()}`,
        jobId,
        parentId,
        // Read off live `user`, not the fixture: the profile is editable now, and a
        // comment posted after a rename should carry the new name.
        authorName: user.displayName,
        authorInitials: `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase(),
        // Matches the avatar on Home and Profile, which both use the accent fill.
        authorColor: '#111114',
        isYou: true,
        body: trimmed,
        gifId,
        createdAt: new Date().toISOString().slice(0, 10),
        likeCount: 0,
      },
    ]);
  }, [user]);

  const deleteComment = useCallback((commentId: string) => {
    setComments((current) =>
      current.filter((comment) => comment.id !== commentId && comment.parentId !== commentId),
    );
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

  const markCommentActivityRead = useCallback((activityId: string) => {
    setCommentActivity((current) =>
      current.map((entry) => (entry.id === activityId ? { ...entry, read: true } : entry)),
    );
  }, []);

  const markAllCommentActivityRead = useCallback(() => {
    setCommentActivity((current) =>
      // Same array back when there's nothing unread, so opening the tab twice doesn't
      // re-render the list for no reason.
      current.some((entry) => !entry.read) ? current.map((entry) => ({ ...entry, read: true })) : current,
    );
  }, []);

  const value = useMemo<CareerDeckState>(() => {
    return {
      isInitialLoading,
      user,
      profileError,
      retryProfile,
      resumes: mockResumes,
      defaultResumeId,
      defaultResume: mockResumes.find((resume) => resume.id === defaultResumeId),
      applications: tracker.applications,
      /*
       * The viewer's own like is folded into the count here rather than at the component.
       *
       * §1.3(b) names this as one of the three modelling problems to fix, and it is still
       * here on purpose: the fix is "store the true count, send `viewerHasLiked`
       * separately", and there is no stored count to be true until phase 3 builds
       * `comments`. Folding it in against a fixture is harmless; folding it in against a
       * real count double-counts, so this line and phase 3 land together.
       */
      comments: comments.map((comment) =>
        likedCommentIds.has(comment.id) ? { ...comment, likeCount: comment.likeCount + 1 } : comment,
      ),
      commentActivity,
      unreadCommentCount: commentActivity.filter((entry) => !entry.read).length,
      followedCompanySlugs: viewer.followedCompanySlugs,
      likedJobIds: viewer.likedJobIds,
      savedJobIds: viewer.savedJobIds,
      seenNewsIds: [...seenNewsIds],
      isFollowing: viewer.isFollowing,
      toggleFollow: viewer.toggleFollow,
      toggleLike: viewer.toggleLike,
      toggleSave: viewer.toggleSave,
      markNewsSeen,
      setDefaultResume,
      setApplicationStatus: tracker.setApplicationStatus,
      logApplication: tracker.logApplication,
      hasApplied: tracker.hasApplied,
      likedCommentIds: [...likedCommentIds],
      toggleCommentLike,
      addComment,
      deleteComment,
      markCommentActivityRead,
      markAllCommentActivityRead,
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
    defaultResumeId,
    tracker.applications,
    tracker.setApplicationStatus,
    tracker.logApplication,
    tracker.hasApplied,
    comments,
    likedCommentIds,
    commentActivity,
    markNewsSeen,
    setDefaultResume,
    toggleCommentLike,
    addComment,
    deleteComment,
    markCommentActivityRead,
    markAllCommentActivityRead,
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
