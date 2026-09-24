import * as Crypto from 'expo-crypto';
import { AppState, Platform } from 'react-native';

import { logImpressions, type FeedSurface, type ImpressionEvent } from '@/lib/api';
import { SKIP_AUTH } from '@/lib/env';
import { reportError } from '@/lib/observability';

/**
 * The impression buffer — README §3.6.
 *
 * "Never one request per card. The client buffers impressions in memory, flushes on a
 * 10-second timer / 25-item batch / app backgrounding, to a single POST that does one
 * multi-row insert. At 50k DAU and ~60 cards a session this is ~3M rows/day — entirely
 * fine for partitioned Postgres, catastrophic as 3M HTTP requests."
 *
 * This is that buffer, and those three triggers.
 *
 * ── Why this is not in the outbox ──────────────────────────────────────────────
 *
 * A failed flush drops its batch. That is deliberate and it is the difference between
 * telemetry and intent: a like the user made is theirs and has to survive a tunnel, while
 * an impression is a row in a training set that will have millions of siblings. Durably
 * queueing impressions would mean a day underground fills the disk with behavioural data
 * and, worse, that a telemetry backlog delays the user's actual writes.
 *
 * ── Why it is logged at all ────────────────────────────────────────────────────
 *
 * §3.6, first line: "this is what buys you a phase-3 ranker. If you don't log from day
 * one, you can't train later." There is no retrofit for a year of missing impressions.
 */

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT_COUNT = 25;

/**
 * A ceiling on the buffer, in case a flush keeps failing while the user keeps scrolling.
 * At that point the oldest impressions are the least interesting ones, so they go first.
 */
const MAX_BUFFERED = 500;

/**
 * One per app launch — §3.6's `session_id`.
 *
 * It is what makes "impressions per session" and "position within this session's feed"
 * answerable, and it is generated here rather than on the server because the server never
 * sees the session, only the batches it produces.
 */
let sessionId: string | null = null;

/**
 * Generated on first use rather than at import.
 *
 * `expo export --platform web` prerenders each route in Node, where evaluating this at
 * module scope would run a native-ish call during a build that will never log an
 * impression. Nothing asks for the id until something is recorded.
 */
function impressionSessionId(): string {
  sessionId ??= Crypto.randomUUID();
  return sessionId;
}

let buffer: ImpressionEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let enabled = false;

export interface ImpressionInput {
  jobId: string;
  surface: FeedSurface;
  position?: number | null;
  dwellMs?: number | null;
  completed?: boolean | null;
}

function stopTimer(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function startTimer(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushImpressions();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Records that a card was shown. Returns immediately; nothing here touches the network.
 *
 * `shownAt` is stamped now rather than at flush time, because the gap between the two is
 * the entire reason this buffer exists and a timestamp that recorded the flush would
 * quietly smear ten seconds of scrolling into one instant.
 */
export function recordImpression(input: ImpressionInput): void {
  if (!enabled) return;

  buffer.push({
    jobId: input.jobId,
    surface: input.surface,
    sessionId: impressionSessionId(),
    position: input.position ?? null,
    dwellMs: input.dwellMs ?? null,
    completed: input.completed ?? null,
    shownAt: new Date().toISOString(),
  });

  if (buffer.length > MAX_BUFFERED) {
    buffer = buffer.slice(buffer.length - MAX_BUFFERED);
  }

  if (buffer.length >= FLUSH_AT_COUNT) {
    void flushImpressions();
  } else {
    startTimer();
  }
}

/**
 * Sends everything buffered, as one call.
 *
 * Re-entrant calls are ignored: the 25-item trigger and the 10-second timer can fire
 * within a frame of each other, and sending the same batch twice would double-count every
 * row in it.
 */
export async function flushImpressions(): Promise<void> {
  if (inFlight || !enabled || buffer.length === 0) return;

  stopTimer();

  const batch = buffer;
  buffer = [];
  inFlight = true;

  try {
    await logImpressions(batch);
  } catch (error) {
    // Dropped on purpose — see the header. Reported so a *persistent* failure is visible:
    // silence here would look exactly like a user who does not scroll.
    reportError(error, { where: 'impressions.flush', dropped: batch.length });
  } finally {
    inFlight = false;
    if (buffer.length > 0) startTimer();
  }
}

/**
 * Turns logging on for a signed-in session and off again at sign-out.
 *
 * `log_impressions` derives `user_id` from the session, so there is no such thing as a
 * signed-out impression. Anything buffered when the session ends belonged to the person
 * who just left, and goes with them.
 *
 * SKIP_AUTH (lib/env.ts) is refused here rather than left to the caller: the fake
 * session it runs on has a userId, so `userId !== null` reads true, but there is no
 * real JWT behind it and `log_impressions` has no grant for an unauthenticated caller
 * — every flush would fail on a 42501 and log a reportError for nothing anyone can act
 * on. Unlike likes and applications, telemetry has no local-only story worth building;
 * not collecting it is the correct behaviour, not a degraded one.
 */
export function setImpressionsEnabled(next: boolean): void {
  const resolved = next && !SKIP_AUTH;
  if (enabled === resolved) return;
  enabled = resolved;

  if (!resolved) {
    stopTimer();
    buffer = [];
  }
}

/**
 * Backgrounding is the third flush trigger from §3.6, and the most important one: a
 * session that ends with the user closing the app is a session whose last ten seconds of
 * scrolling are the most engaged part of it.
 */
if (Platform.OS !== 'web' || typeof document !== 'undefined') {
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') void flushImpressions();
  });
}
