import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  confirmResumeProfile,
  deleteResume,
  fetchMatchScores,
  fetchResumeUrl,
  fetchResumes,
  parseResume,
  setDefaultResume,
  uploadResume,
} from '@/lib/api';
import { isServiceConfigured } from '@/lib/service';
import type { UploadedResume } from '@/lib/api';
import type { MatchScore, Resume, ResumeSeniority } from '@/types';

/**
 * Resumes — README §3.9, moved out of `CareerDeckContext` and into a real read.
 *
 * `CareerDeckContext` predicted this exactly: "Resumes (phase 4's storage bucket and `resumes`
 * table) … each is a fixture behind a real-looking interface, and each becomes a hook of its own
 * the way applications and comments did." This is that hook, and `defaultResumeId` — a
 * `useState` since the first fixture — is gone with it. Exactly one default is now a unique
 * index rather than a convention the last render happened to satisfy.
 *
 * ── Not in the outbox ─────────────────────────────────────────────────────────
 *
 * Phase 2 put likes, saves and follows through `lib/outbox.ts` so a tap on a train survives.
 * Nothing here goes through it, and the reason is the same one PHASE3.md §5 gave for comments,
 * one step further along: an upload is megabytes of body and a parse is a model call that can
 * refuse. Neither is a state-setting toggle that can be replayed in any order, and a queued
 * upload that fires four hours later against a resume the user has since deleted is a worse
 * outcome than an upload that failed while they were watching.
 *
 * `setDefault` is the exception that proves it — it *is* a state-setting toggle — and it still
 * does not queue, because it only makes sense next to resumes the user can currently see.
 */

export function resumesKey(userId: string | null) {
  return ['resumes', userId ?? 'anonymous'] as const;
}

export interface ResumeState {
  resumes: Resume[];
  /** The one the apply sheet reaches for, and the one every match score is computed against. */
  defaultResume: Resume | undefined;
  isLoading: boolean;
  error: Error | null;

  /** True while any mutation is in flight, so a screen can disable its buttons at once. */
  isBusy: boolean;
  /** Whether this build can parse at all — the API service is optional. `lib/service.ts`. */
  canParse: boolean;

  /**
   * Stores a resume, or hands back the identical one already on the shelf.
   *
   * `reused: true` means these exact bytes were already here, so the caller must **not** go on
   * to `parse` — the existing row already carries a finished profile, and re-parsing it is a
   * model call spent to learn something the database has. See `uploadResume`.
   */
  upload: (input: { name: string; bytes: ArrayBuffer; focus?: string }) => Promise<UploadedResume>;
  parse: (resumeId: string) => Promise<void>;
  confirm: (
    resumeId: string,
    edits: {
      skills?: string[];
      seniority?: ResumeSeniority | null;
      yearsExperience?: number | null;
      location?: string | null;
    },
  ) => Promise<Resume>;
  setDefault: (resumeId: string) => Promise<void>;
  remove: (resumeId: string) => Promise<void>;
  /** A short-lived signed URL for one resume. Every call writes a `pii_access_log` row. */
  openUrl: (resumeId: string) => Promise<string>;
}

const EMPTY: Resume[] = [];

export function useResumes(userId: string | null): ResumeState {
  const queryClient = useQueryClient();
  const key = useMemo(() => resumesKey(userId), [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: fetchResumes,
    enabled: userId !== null,
    /*
     * A resume changes when the user changes it, which is always through this hook — so the
     * cache is authoritative between mutations and there is nothing to poll for. The exception
     * is a parse, which the mutation below invalidates when it lands.
     */
    staleTime: 5 * 60_000,
  });

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    /*
     * Every cached match score was computed against the resume that just changed. The database
     * has already dropped them (`invalidate_match_scores`), so this is only the client catching
     * up — but without it the ring keeps showing yesterday's number until something else
     * happens to refetch.
     */
    await queryClient.invalidateQueries({ queryKey: ['match', 'scores'] });
  }, [queryClient, key]);

  const uploadMutation = useMutation({
    mutationFn: uploadResume,
    onSuccess: invalidate,
  });

  const parseMutation = useMutation({
    mutationFn: parseResume,
    /*
     * `onSettled`, not `onSuccess`. A failed parse writes `parse_status = 'failed'` and a reason
     * the review screen shows, so the refetch matters *more* on the failure path — that row is
     * the only place the user learns what went wrong.
     */
    onSettled: invalidate,
  });

  const confirmMutation = useMutation({
    mutationFn: (input: Parameters<ResumeState['confirm']>) =>
      confirmResumeProfile(input[0], input[1]),
    onSuccess: invalidate,
  });

  const defaultMutation = useMutation({
    mutationFn: setDefaultResume,
    /*
     * Optimistic, because this one is instant everywhere else in the app and a checkmark that
     * waits for a round trip reads as a broken tap — Appendix A's rule, applied to the one
     * mutation here that is a toggle.
     */
    onMutate: async (resumeId: string) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Resume[]>(key);
      queryClient.setQueryData<Resume[]>(key, (current) =>
        (current ?? []).map((resume) => ({ ...resume, isDefault: resume.id === resumeId })),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: deleteResume,
    onSuccess: invalidate,
  });

  const resumes = query.data ?? EMPTY;

  return {
    resumes,
    defaultResume: resumes.find((resume) => resume.isDefault),
    isLoading: query.isLoading,
    error: query.error as Error | null,
    isBusy:
      uploadMutation.isPending ||
      parseMutation.isPending ||
      confirmMutation.isPending ||
      defaultMutation.isPending ||
      removeMutation.isPending,
    canParse: isServiceConfigured(),

    upload: useCallback((input) => uploadMutation.mutateAsync(input), [uploadMutation]),
    parse: useCallback(async (id: string) => { await parseMutation.mutateAsync(id); }, [parseMutation]),
    confirm: useCallback(
      (resumeId, edits) => confirmMutation.mutateAsync([resumeId, edits]),
      [confirmMutation],
    ),
    setDefault: useCallback(async (id: string) => { await defaultMutation.mutateAsync(id); }, [defaultMutation]),
    remove: useCallback(async (id: string) => { await removeMutation.mutateAsync(id); }, [removeMutation]),
    openUrl: useCallback((id: string) => fetchResumeUrl(id), []),
  };
}

/**
 * Signed URLs for the resumes on the shelf, so a bubble can show the actual document.
 *
 * ── Why this shares the viewer's cache ────────────────────────────────────────
 *
 * The key is `['resume', 'url', id]` — byte-identical to the one `ResumeViewerModal` uses, and
 * that is the whole trick. The shelf and the viewer are two views of one document, so they
 * should cost one signing between them: the shelf warms the URL, the viewer opens on a cache
 * hit instead of a spinner, and `pii_access_log` gets one row rather than two.
 *
 * ── Why logging these reads is correct, not noise ─────────────────────────────
 *
 * §3.9 asks that every read of a resume be logged, and a thumbnail *is* a read — the document
 * is on screen, with a name and a phone number on it. A preview that skipped the log would be
 * exactly the hole PHASE4.md §4.2 refused to leave when it denied the bucket `select` to its
 * own owner. So the rows are the honest cost of showing the file, and the 4-minute window on
 * the query is what keeps it one row per viewing rather than one per render.
 *
 * Failure is silent by design: no URL means the bubble falls back to its glyph. A shelf that
 * error-states because a preview could not be signed would be worse than one without previews,
 * and the API service is optional in the first place (`lib/service.ts`).
 */
export function useResumePreviewUrls(
  resumes: Resume[],
  enabled = true,
): Map<string, string> {
  const queries = useQueries({
    queries: resumes.map((resume) => ({
      queryKey: ['resume', 'url', resume.id] as const,
      queryFn: () => fetchResumeUrl(resume.id),
      enabled: enabled && isServiceConfigured(),
      // Four minutes against a URL signed for five, matching the viewer exactly. Drifting
      // these apart is what would double the signings.
      staleTime: 4 * 60_000,
      gcTime: 4 * 60_000,
      retry: false,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, string>();
    resumes.forEach((resume, index) => {
      const url = queries[index]?.data;
      if (typeof url === 'string') map.set(resume.id, url);
    });
    return map;
    // `queries` is a new array every render; the URLs inside it are what matter, so the
    // dependency is their joined value rather than the wrapper.
  }, [resumes, queries.map((query) => query.data).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Match scores for whatever is on screen — README §3.10.
 *
 * Deliberately the same shape as `useCommentCounts`, because it is the same decision one phase
 * later: a per-reader number that would make every feed page uncacheable if it rode on the card.
 *
 * The one difference worth knowing about is that this read *writes*. `match_scores()` computes
 * and stores the pairs it does not already hold, so the first scroll through a feed is doing
 * real work and the second is a cache hit. That is §3.10's "recomputed lazily on feed build for
 * the candidate set only, never for the whole corpus" — the alternative is scoring 30,800
 * postings against every account for the handful anyone will ever see.
 *
 * An empty map is the honest answer for a user with no parsed resume, and the ring reads that
 * as "hide" rather than as 0%.
 */
export function useMatchScores(jobIds: string[]): Map<string, MatchScore> {
  // Sorted and joined so a re-render producing an equal-but-new array does not refetch.
  const key = useMemo(() => [...jobIds].sort().join(','), [jobIds]);

  const query = useQuery({
    queryKey: ['match', 'scores', key],
    queryFn: () => fetchMatchScores(jobIds),
    enabled: jobIds.length > 0,
    /*
     * Longer than the comment counts' minute. A score moves only when the resume or the
     * preferences move, and both of those invalidate this key explicitly — so re-reading on a
     * timer would be a request per scroll for a number that is already correct.
     */
    staleTime: 10 * 60_000,
  });

  const empty = useMemo(() => new Map<string, MatchScore>(), []);
  return query.data ?? empty;
}
