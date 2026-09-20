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
import { mockApplications } from '@/data/mockApplications';
import { mockCommentActivity } from '@/data/mockCommentActivity';
import { mockCompanies } from '@/data/mockCompanies';
import { mockJobs } from '@/data/mockJobs';
import { defaultResumeId as seedDefaultResumeId, mockResumes } from '@/data/mockResumes';
import { mockUser } from '@/data/mockUser';
import type {
  Application,
  ApplicationStatus,
  CommentActivity,
  Company,
  Job,
  Resume,
  User,
} from '@/types';

/**
 * Single in-memory store for CareerDeck.
 *
 * Milestone 0 has no backend, so following / liking / saving / the default resume live
 * here as plain React state and reset when the app restarts. When a real API arrives,
 * only this file needs to change - screens read from the hooks below.
 */

interface CareerDeckState {
  /**
   * True for a short window right after mount, before "data" is considered to have
   * arrived. There's no real fetch behind any of this yet — it's a stand-in so Home's
   * skeleton states are wired up and visible now, ready to key off a real request once
   * one exists.
   */
  isInitialLoading: boolean;
  user: User;
  jobs: Job[];
  companies: Company[];
  resumes: Resume[];
  defaultResumeId: string;
  /** The user's tracked applications, newest activity first. */
  applications: Application[];
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

/** How long Home's skeletons stay up before the (currently instant) mock data "arrives". */
const INITIAL_LOAD_MS = 650;

export function CareerDeckProvider({ children }: { children: ReactNode }) {
  const [followedIds, setFollowedIds] = useState<Set<string>>(seedFollowedCompanies);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set<string>());
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set<string>());
  const [seenNewsIds, setSeenNewsIds] = useState<Set<string>>(() => new Set<string>());
  const [defaultResumeId, setDefaultResumeId] = useState(seedDefaultResumeId);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [applications, setApplications] = useState<Application[]>(mockApplications);
  const [weeklyGoal, setWeeklyGoalState] = useState(DEFAULT_WEEKLY_GOAL);
  // Seeded with a single day's grant. Accrual across days, and the balance surviving a
  // restart, both need storage this milestone doesn't have — see the note on the file.
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

  const setCredits = useCallback((next: number) => {
    creditsRef.current = next;
    setAutoApplyCredits(next);
  }, []);
  const [commentActivity, setCommentActivity] = useState<CommentActivity[]>(mockCommentActivity);

  useEffect(() => {
    const timer = setTimeout(() => setIsInitialLoading(false), INITIAL_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);

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

  const setWeeklyGoal = useCallback((target: number) => {
    setWeeklyGoalState(Math.min(Math.max(Math.round(target), MIN_WEEKLY_GOAL), MAX_WEEKLY_GOAL));
  }, []);

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
      user: mockUser,
      jobs,
      companies,
      resumes: mockResumes,
      defaultResumeId,
      defaultResume: mockResumes.find((resume) => resume.id === defaultResumeId),
      applications,
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
      markCommentActivityRead,
      markAllCommentActivityRead,
      weeklyGoal,
      setWeeklyGoal,
      autoApplyCredits,
      spendAutoApplyCredit,
      awardStreakBonus,
      lastStreakAward,
    };
  }, [
    isInitialLoading,
    followedIds,
    likedIds,
    savedIds,
    seenNewsIds,
    defaultResumeId,
    applications,
    commentActivity,
    toggleFollow,
    toggleLike,
    toggleSave,
    markNewsSeen,
    setDefaultResume,
    setApplicationStatus,
    logApplication,
    markCommentActivityRead,
    markAllCommentActivityRead,
    weeklyGoal,
    setWeeklyGoal,
    autoApplyCredits,
    spendAutoApplyCredit,
    awardStreakBonus,
    lastStreakAward,
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
