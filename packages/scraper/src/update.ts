import { finishRun, startRun, type DB } from '@nj/database';
import { fetchGamesPayload, FetchError, type FetchOptions } from './fetcher.ts';
import { ingestPayload, type IngestResult } from './ingest.ts';

/** Fetch the live official payload and ingest it. Fetch failures are recorded as failed runs too. */
export async function runUpdate(db: DB, opts: { trigger: string; fetch?: FetchOptions; log?: (m: string) => void }): Promise<IngestResult> {
  const log = opts.log ?? (() => {});
  let fetched;
  try {
    fetched = await fetchGamesPayload({ log, ...opts.fetch });
  } catch (e) {
    const now = Date.now();
    const runId = startRun(db, { source: 'official', trigger: opts.trigger, observedAt: now, startedAt: now });
    const err = e as FetchError;
    finishRun(db, runId, { status: 'failed', error: err.message, http_status: err.status ?? null, duration_ms: Date.now() - now });
    log(`Update failed: ${err.message}`);
    return { runId, status: 'failed', error: err.message };
  }
  const result = ingestPayload(db, { body: fetched.body, observedAt: fetched.fetchedAt, source: 'official', trigger: opts.trigger, httpStatus: fetched.status });
  if (result.status === 'failed') log(`Validation failed: ${result.error}`);
  else if (result.status === 'stale') log(`Update skipped: ${result.error}`);
  else log(`Update ${result.status}: ${result.report?.activeGames} active games, ${result.snapshots ?? 0} snapshots, ${result.events ?? 0} change events.`);
  return result;
}
