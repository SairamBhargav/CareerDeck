/** Retry a rolled-back statement timeout with smaller transactions, never skip a row. */
export async function writeBatches<T>(
  rows: T[],
  size: number,
  operation: string,
  write: (batch: T[]) => Promise<void>,
): Promise<void> {
  let batchSize = size;
  async function attempt(batch: T[]): Promise<void> {
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
      throw new Error(`${operation} (${batch.length} row(s)): ${failure?.code ?? ''} ${failure?.message ?? String(error)}`, { cause: error });
    }
  }

  for (let offset = 0; offset < rows.length;) {
    const batch = rows.slice(offset, offset + batchSize);
    await attempt(batch);
    offset += batch.length;
  }
}
