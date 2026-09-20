import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { mockApplications } from '@/data/mockApplications';
import { mockCommentActivity } from '@/data/mockCommentActivity';
import { mockComments } from '@/data/mockComments';
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
  JobComment,
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
  const [commentActivity, setCommentActivity] = useState<CommentActivity[]>(mockCommentActivity);
  const [comments, setComments] = useState<JobComment[]>(mockComments);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(() => new Set<string>());

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

  const toggleCommentLike = useCallback((commentId: string) => {
    setLikedCommentIds((current) => toggleInSet(current, commentId));
  }, []);

  const addComment = useCallback((jobId: string, body: string, parentId: string | null, gifId?: string) => {
    const trimmed = body.trim();
    // A GIF on its own is a comment; text on its own is a comment; neither is not.
    if (trimmed.length === 0 && gifId === undefined) return;

    setComments((current) => [
      ...current,
      {
        id: `c-local-${Date.now()}`,
        jobId,
        parentId,
        authorName: mockUser.displayName,
        authorInitials: `${mockUser.firstName.charAt(0)}${mockUser.lastName.charAt(0)}`.toUpperCase(),
        // Matches the avatar on Home and Profile, which both use the accent fill.
        authorColor: '#111114',
        isYou: true,
        body: trimmed,
        gifId,
        createdAt: new Date().toISOString().slice(0, 10),
        likeCount: 0,
      },
    ]);
  }, []);

  const deleteComment = useCallback((commentId: string) => {
    setComments((current) =>
      current.filter((comment) => comment.id !== commentId && comment.parentId !== commentId),
    );
  }, []);

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
    };
  }, [
    isInitialLoading,
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
