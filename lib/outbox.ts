import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

import {
  createApplication,
  setApplicationStatus,
  setCompanyFollow,
  setJobInteraction,
  type InteractionKind,
} from '@/lib/api';
import { reportError } from '@/lib/observability';
import type { ApplicationSource, ApplicationStatus } from '@/types';

/**
 * The offline outbox — README §12's last row, "goes offline: queues mutations in an
 * outbox, flushed in order on reconnect", and Appendix A's second named client behaviour.
 *
 * Every write the user makes goes in here first and reaches Postgres second. The optimistic
 * update is applied by the caller against the TanStack cache, the operation is appended to
 * a durable queue, and the queue drains in order whenever it can. On a subway platform that
 * means a like still looks liked, still *is* liked when the train surfaces, and is liked
 * exactly once.
 *
 * ── Ordering is the whole point ────────────────────────────────────────────────
 *
 * Appendix A: "an ordered outbox so an offline like-then-unlike doesn't replay out of order
 * and leave the wrong final state." So the queue is strictly sequential — one operation in
 * flight at a time, and a failure stops the drain rather than skipping ahead. Parallelism
 * here would be a correctness bug wearing a performance costume.
 *
 * Two things make that affordable. Every operation is idempotent by construction (§11:
 * toggles set a state rather than flipping one), so a retry after an ambiguous failure
 * cannot invert anything. And consecutive operations on the same subject collapse: liking,
 * unliking and liking again while offline sends one call, not three.
 *
 * ── What is deliberately not in here ───────────────────────────────────────────
 *
 * Impressions. They are buffered in `lib/impressions.ts` and dropped if a flush fails,
 * because a lost impression is a lost training row and a lost like is a lost user action.
 * Putting telemetry in the same queue as intent means a telemetry failure can block intent.
 *
 * ── Why AsyncStorage ───────────────────────────────────────────────────────────
 *
 * Appendix A suggests expo-sqlite or MMKV. Neither is a dependency yet, and both are native
 * modules, which in Expo Go is a non-starter. AsyncStorage is already here (it holds the
 * encrypted session), is SQLite-backed on Android, and a queue that is measured in tens of
 * entries does not need a query planner. The whole queue is rewritten on every change,
 * which is the one cost — and it is a few kilobytes.
 */

const STORAGE_KEY = 'careerdeck.outbox.v1';

/** Retry backoff, doubling from the first to the last and then staying there. */
const RETRY_MS = [2_000, 5_000, 15_000, 60_000];

/**
 * Operations dropped after this many failed attempts.
 *
 * A transient failure resolves long before this. Something that has failed twelve times
 * across twelve back-offs is not going to start working, and a queue head that can never
 * drain blocks every operation behind it — which is a worse outcome than losing the one
 * that is stuck. Anything dropped is reported.
 */
const MAX_ATTEMPTS = 12;

export type OutboxOperation =
  | { kind: 'interaction'; jobId: string; interaction: InteractionKind; on: boolean }
  | { kind: 'follow'; companySlug: string; on: boolean }
  | { kind: 'application.create'; jobId: string; source: ApplicationSource; appliedAt: string }
  | { kind: 'application.status'; jobId: string; status: ApplicationStatus };

interface OutboxEntry {
  id: string;
  /**
   * Who queued it. An entry is only ever sent under the session that created it — without
   * this, signing out with pending writes and signing back in as someone else would replay
   * one person's likes into another person's account.
   */
  userId: string;
  operation: OutboxOperation;
  queuedAt: string;
  attempts: number;
}

export interface OutboxSnapshot {
  pending: number;
  /** Operations that reached the database since the last notification. */
  sent: OutboxOperation[];
}

type Listener = (snapshot: OutboxSnapshot) => void;

let queue: OutboxEntry[] = [];
let loaded = false;
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserId: string | null = null;
const listeners = new Set<Listener>();

/**
 * The subject an operation is about.
 *
 * Two entries with the same key are two statements about the same thing, so only the last
 * one is true. Application creation is deliberately absent: it is keyed by job at the
 * database (`unique (user_id, job_id)`) but a create and a later stage change are
 * different statements, and collapsing them would lose the stage.
 */
function collapseKey(operation: OutboxOperation): string | null {
  switch (operation.kind) {
    case 'interaction':
      return `interaction:${operation.jobId}:${operation.interaction}`;
    case 'follow':
      return `follow:${operation.companySlug}`;
    case 'application.status':
      return `application.status:${operation.jobId}`;
    default:
      return null;
  }
}

function notify(sent: OutboxOperation[] = []): void {
  const snapshot: OutboxSnapshot = { pending: queue.length, sent };
  for (const listener of listeners) listener(snapshot);
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    // The queue is still correct in memory; it just will not survive a cold start. Worth
    // reporting and not worth failing the user's action over.
    reportError(error, { where: 'outbox.persist', pending: queue.length });
  }
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) queue = parsed as OutboxEntry[];
  } catch (error) {
    // A corrupt queue is unrecoverable and un-diagnosable from here. Clearing it costs
    // whatever was pending; keeping it would fail the same way on every launch.
    reportError(error, { where: 'outbox.load' });
    queue = [];
  }
}

/**
 * A failure that will fail again no matter how long we wait.
 *
 * PostgREST hands back the Postgres `code` for anything the database refused — a missing
 * company slug (23503), a permission failure (42501), a bad uuid (22P02). Retrying those
 * is just a slower way to lose the entry, and keeping them at the head of the queue blocks
 * everything behind them. A network failure has no such code, and is exactly what the
 * queue exists for.
 *
 * The one deliberate exception is the auth codes: a session that has expired is retryable,
 * because the Supabase client refreshes it and the next attempt will be authorized.
 */
function isPermanent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0) return false;
  return code !== '28000' && code !== 'PGRST301' && code !== '401';
}

async function send(operation: OutboxOperation): Promise<void> {
  switch (operation.kind) {
    case 'interaction':
      await setJobInteraction(operation.jobId, operation.interaction, operation.on);
      return;
    case 'follow':
      await setCompanyFollow(operation.companySlug, operation.on);
      return;
    case 'application.create':
      await createApplication({
        jobId: operation.jobId,
        source: operation.source,
        appliedAt: operation.appliedAt,
      });
      return;
    case 'application.status':
      await setApplicationStatus(operation.jobId, operation.status);
      return;
  }
}

function scheduleRetry(attempts: number): void {
  if (retryTimer) return;
  const delay = RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)] ?? 60_000;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drain();
  }, delay);
}

/**
 * Sends everything that can be sent, oldest first, and stops at the first thing that
 * cannot.
 *
 * Re-entrant calls are ignored rather than queued: a flush triggered by a tap while
 * another is mid-flight would otherwise interleave two operations on the same subject.
 */
export async function drain(): Promise<void> {
  if (draining) return;
  await load();

  if (currentUserId === null || queue.length === 0) return;

  draining = true;
  const sent: OutboxOperation[] = [];

  try {
    while (queue.length > 0) {
      const entry = queue[0];
      if (!entry) break;

      // Queued by somebody else, on this device, before a sign-out. It is not ours to
      // send and it is not ours to keep.
      if (entry.userId !== currentUserId) {
        queue.shift();
        continue;
      }

      try {
        await send(entry.operation);
        queue.shift();
        sent.push(entry.operation);
      } catch (error) {
        entry.attempts += 1;

        if (isPermanent(error) || entry.attempts >= MAX_ATTEMPTS) {
          reportError(error, {
            where: 'outbox.drain',
            operation: entry.operation.kind,
            attempts: entry.attempts,
            dropped: true,
          });
          queue.shift();
          continue;
        }

        // Transient. Leave it at the head so ordering holds, and come back to it.
        scheduleRetry(entry.attempts);
        break;
      }
    }
  } finally {
    draining = false;
    await persist();
    notify(sent);
  }
}

/**
 * Queues an operation and starts a drain.
 *
 * Returns as soon as the operation is durable, not when it lands. Callers have already
 * applied their optimistic update; awaiting the network here would make every tap feel
 * like the network.
 */
export async function enqueue(operation: OutboxOperation): Promise<void> {
  await load();

  if (currentUserId === null) {
    // Nothing in the app is reachable signed out, so this is a bug rather than a state.
    // Dropping it is better than queueing an operation that can never be attributed.
    reportError(new Error('An operation was queued with no signed-in user.'), {
      where: 'outbox.enqueue',
      operation: operation.kind,
    });
    return;
  }

  const key = collapseKey(operation);
  if (key !== null) {
    queue = queue.filter(
      (entry) => entry.userId !== currentUserId || collapseKey(entry.operation) !== key,
    );
  }

  queue.push({
    // Date.now() alone collides when two toggles land in the same millisecond, which a
    // double-tap genuinely does.
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    userId: currentUserId,
    operation,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });

  await persist();
  notify();
  void drain();
}

/**
 * Tells the outbox who is signed in.
 *
 * Called on every session change. Signing out does not clear the queue: the pending writes
 * still belong to the user who made them, and if they sign back in on the same device the
 * queue drains as though nothing happened. What it does do is stop the drain, so nothing
 * is ever sent under a session that did not create it.
 */
export function setOutboxUser(userId: string | null): void {
  if (currentUserId === userId) return;
  currentUserId = userId;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  if (userId !== null) void drain();
}

export function subscribeToOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function pendingCount(): Promise<number> {
  await load();
  return queue.filter((entry) => entry.userId === currentUserId).length;
}

/**
 * Coming back to the foreground is the closest thing to a reconnect signal this app has.
 *
 * `@react-native-community/netinfo` would give a real one, and TanStack Query's
 * `onlineManager` is built to take it. It is not a dependency yet and it is a native
 * module, so the app would need a development build to run at all. Until that trade is
 * worth making, a foreground drain plus the backoff above covers the case that actually
 * happens: the phone was in a pocket with no signal, and now it is in a hand with some.
 */
if (Platform.OS !== 'web' || typeof document !== 'undefined') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void drain();
  });
}
