/**
 * A dropped connection, not a database answer. The 2026-09-29 crawl lost 8 of 59 boards to
 * blips of a few seconds ("TypeError: fetch failed") while every board around them succeeded.
 */
function isTransient(failure: { code?: string; message?: string } | undefined): boolean {
  const text = `${failure?.code ?? ''} ${failure?.message ?? ''}`;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|UND_ERR_|socket hang up|\b50[234]\b/i.test(text);
}

/** Waits long enough to outlast the 8-second outage seen on 2026-09-29: 2 + 4 + 8 seconds. */
const TRANSIENT_DELAYS_MS = [2_000, 4_000, 8_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a rolled-back statement timeout with smaller transactions, and a dropped connection
 * with a short backoff. Never skip a row.
 *
 * Retrying is only safe because every write routed through here is idempotent: the job upsert
 * reconciles by identity, raw landing is ON CONFLICT DO NOTHING, and the timestamp and
 * processed_at updates set the same value twice. A new caller must be too.
 */
export async function writeBatches<T>(
  rows: T[],
  size: number,
  operation: string,
  write: (batch: T[]) => Promise<void>,
): Promise<void> {
  let batchSize = size;
  async function attempt(batch: T[], retry = 0): Promise<void> {
    try {
      await write(batch);
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      if (failure?.code === '57014' && batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        batchSize = Math.min(batchSize, middle);
        await attempt(batch.slice(0, middle));
        await attempt(batch.slice(middle));
        return;
      }
      const delay = TRANSIENT_DELAYS_MS[retry];
      /*
       * A single row that still times out is waiting on the database, not too big for it: on
       * 2026-10-08 one Elastic posting hit the 8 s limit, failing the whole nightly run, and saved
       * in well under a second when the board was re-run minutes later. So it gets the same
       * backoff as a dropped connection before it counts as a failure.
       */
      const slowMoment = failure?.code === '57014' && batch.length === 1;
      if (delay !== undefined && (isTransient(failure) || slowMoment)) {
        await sleep(delay);
        await attempt(batch, retry + 1);
        return;
      }
      throw new Error(`${operation} (${batch.length} row(s)): ${failure?.code ?? ''} ${failure?.message ?? String(error)}`, { cause: error });
    }
  }

  for (let offset = 0; offset < rows.length;) {
    const batch = rows.slice(offset, offset + batchSize);
    await attempt(batch);
    offset += batch.length;
  }
}
