import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AUTO_APPLY_ECONOMY, DEFAULT_WEEKLY_GOAL, MAX_WEEKLY_GOAL, MIN_WEEKLY_GOAL } from '@/constants/goal';
import { useAuth } from '@/context/AuthContext';
import { mockApplications } from '@/data/mockApplications';
import { mockCommentActivity } from '@/data/mockCommentActivity';
import { mockComments } from '@/data/mockComments';
import { mockCompanies } from '@/data/mockCompanies';
import { mockJobs } from '@/data/mockJobs';
import { defaultResumeId as seedDefaultResumeId, mockResumes } from '@/data/mockResumes';
import { useProfile } from '@/hooks/useProfile';
import type {
  Application,
  ApplicationStatus,
  CommentActivity,
  Company,
  Job,
  JobComment,
  Resume,
  User,
  UserIdentityEdit,
} from '@/types';

/**
 * Single store for CareerDeck.
 *
 * Phase 0 moved identity and preferences onto Postgres — `user`, `preferredRoles`,
 * `preferredLocations` and `weeklyGoal` are now reads and writes against Supabase, and
 * they survive a restart. Everything else below is still in-memory mock state and resets
 * on reload; phases 1 and 2 move jobs, interactions and applications the same way.
 *
 * Screens read from the hooks below, so a field graduating from mock to server changes
 * this file and nothing else.
 */

interface CareerDeckState {
  /** True while the signed-in user's profile is in flight. Home's skeletons key off it. */
  isInitialLoading: boolean;
  /** Null while the profile is loading, or if it failed to load. */
  user: User | null;
  /** Set when the profile could not be read — the app shell can't be trusted until it is. */
  profileError: Error | null;
  retryProfile: () => void;
  jobs: Job[];
  companies: Company[];
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
  followedCompanyIds: string[];
  likedJobIds: string[];
  savedJobIds: string[];
  /** News items the user has already watched in the stories row. */
  seenNewsIds: string[];
  isFollowing: (companyId: string) => boolean;
  toggleFollow: (companyId: string) => void;
  toggleLike: (jobId: string) => void;
  toggleSave: (jobId: string) => void;
  /** One-way: a story that has been watched stays watched for the session. */
  markNewsSeen: (newsId: string) => void;
  setDefaultResume: (resumeId: string) => void;
  /** Moves an application to a new stage and stamps `updatedAt`. */
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

function seedFollowedCompanies(): Set<string> {
  return new Set(mockCompanies.filter((company) => company.isFollowing).map((company) => company.id));
}

export function CareerDeckProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const {
    profile,
    isLoading: isInitialLoading,
    error: profileError,
    retry: retryProfile,
    updateIdentity: writeIdentity,
    updatePreferences,
  } = useProfile(userId);

  const [followedIds, setFollowedIds] = useState<Set<string>>(seedFollowedCompanies);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set<string>());
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set<string>());
  const [seenNewsIds, setSeenNewsIds] = useState<Set<string>>(() => new Set<string>());
  const [defaultResumeId, setDefaultResumeId] = useState(seedDefaultResumeId);
  const [applications, setApplications] = useState<Application[]>(mockApplications);
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

  const setCredits = useCallback((next: number) => {
    creditsRef.current = next;
    setAutoApplyCredits(next);
  }, []);
  const [commentActivity, setCommentActivity] = useState<CommentActivity[]>(mockCommentActivity);
  const [comments, setComments] = useState<JobComment[]>(mockComments);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(() => new Set<string>());

  const toggleFollow = useCallback((companyId: string) => {
    setFollowedIds((current) => toggleInSet(current, companyId));
  }, []);

  const toggleLike = useCallback((jobId: string) => {
    setLikedIds((current) => toggleInSet(current, jobId));
  }, []);

  const toggleSave = useCallback((jobId: string) => {
    setSavedIds((current) => toggleInSet(current, jobId));
  }, []);

  // Returning the same Set when nothing changes matters here: this fires from an effect
  // on every story frame, and a fresh Set each time would re-render the whole tree.
  const markNewsSeen = useCallback((newsId: string) => {
    setSeenNewsIds((current) => (current.has(newsId) ? current : new Set(current).add(newsId)));
  }, []);

  const setDefaultResume = useCallback((resumeId: string) => {
    setDefaultResumeId(resumeId);
  }, []);

  const setApplicationStatus = useCallback((applicationId: string, status: ApplicationStatus) => {
    const today = new Date().toISOString().slice(0, 10);
    setApplications((current) =>
      current.map((application) =>
        application.id === applicationId ? { ...application, status, updatedAt: today } : application,
      ),
    );
  }, []);

  const logApplication = useCallback((jobId: string, source: Application['source']) => {
    const today = new Date().toISOString().slice(0, 10);
    setApplications((current) => {
      // Re-applying to something already tracked shouldn't create a duplicate row —
      // the user is telling us about the same application again.
      if (current.some((application) => application.jobId === jobId)) return current;
      return [
        {
          id: `app-${jobId}-${Date.now()}`,
          jobId,
          status: 'applied',
          source,
          appliedAt: today,
          updatedAt: today,
          selfReported: true,
        },
        ...current,
      ];
    });
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
    const companies = mockCompanies.map((company) => ({
      ...company,
      isFollowing: followedIds.has(company.id),
    }));

    const jobs = mockJobs.map((job) => ({
      ...job,
      isLiked: likedIds.has(job.id),
      isSaved: savedIds.has(job.id),
    }));

    return {
      isInitialLoading,
      user,
      profileError,
      retryProfile,
      jobs,
      companies,
      resumes: mockResumes,
      defaultResumeId,
      defaultResume: mockResumes.find((resume) => resume.id === defaultResumeId),
      applications,
      // The viewer's own like is folded in here rather than at the component, so a
      // count is never the raw fixture number plus a separately-tracked flag.
      comments: comments.map((comment) =>
        likedCommentIds.has(comment.id) ? { ...comment, likeCount: comment.likeCount + 1 } : comment,
      ),
      commentActivity,
      unreadCommentCount: commentActivity.filter((entry) => !entry.read).length,
      followedCompanyIds: [...followedIds],
      likedJobIds: [...likedIds],
      savedJobIds: [...savedIds],
      seenNewsIds: [...seenNewsIds],
      isFollowing: (companyId: string) => followedIds.has(companyId),
      toggleFollow,
      toggleLike,
      toggleSave,
      markNewsSeen,
      setDefaultResume,
      setApplicationStatus,
      logApplication,
      hasApplied: (jobId: string) => applications.some((application) => application.jobId === jobId),
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
    followedIds,
    likedIds,
    savedIds,
    seenNewsIds,
    defaultResumeId,
    applications,
    comments,
    likedCommentIds,
    commentActivity,
    toggleFollow,
    toggleLike,
    toggleSave,
    markNewsSeen,
    setDefaultResume,
    setApplicationStatus,
    logApplication,
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
