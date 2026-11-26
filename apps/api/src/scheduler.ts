import { lastRunWithStatus, type DB } from '@nj/database';
import type { IngestResult } from '@nj/scraper';

/**
 * In-process scheduler. Checks once per `intervalMs` (default 6h — NJ updates claim counts roughly daily),
 * and on startup if the last successful official check is older than the interval.
 * Failures back off to a 30-minute retry instead of hammering the site.
 */
export function startScheduler(p: { db: DB; intervalMs: number; update: () => Promise<IngestResult>; onUpdated: () => void; retryMs?: number }) {
  const retryMs = p.retryMs ?? 30 * 60_000;
  let timer: NodeJS.Timeout | undefined;
  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
    timer.unref?.();
  };
  const tick = async () => {
    try {
      const r = await p.update();
      p.onUpdated();
      schedule(r.status === 'failed' ? retryMs : p.intervalMs);
    } catch (e) {
      console.error('[scheduler] unexpected error', e);
      schedule(retryMs);
    }
  };
  const last = lastRunWithStatus(p.db, ['success', 'unchanged', 'stale', 'failed']);
  const due = !last || Date.now() - last.started_at > p.intervalMs || last.status === 'failed';
  schedule(due ? 2_000 : p.intervalMs - (Date.now() - last!.started_at));
  console.log(`[scheduler] next update ${due ? 'in a few seconds' : `in ${Math.round((p.intervalMs - (Date.now() - last!.started_at)) / 60_000)} min`}`);
  return () => clearTimeout(timer);
}
