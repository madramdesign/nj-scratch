import { type DB } from '@nj/database';
import { ingestPayload, rebuildChangeEvents } from './ingest.ts';
import { USER_AGENT } from './fetcher.ts';

/**
 * Backfill history from Internet Archive captures of the OFFICIAL NJ Lottery API.
 * These are byte-for-byte copies of what njlottery.com served at capture time, so the
 * data is still official — only the transport differs. Each capture is validated exactly
 * like a live response; captures that fail validation are recorded as failed runs and skipped.
 */
const CDX = 'https://web.archive.org/cdx/search/cdx';

export interface Capture {
  timestamp: string; // yyyymmddhhmmss (UTC)
  original: string;
}

export function captureTime(ts: string): number {
  return Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14));
}

export async function listCaptures(fetchImpl: typeof fetch = fetch): Promise<Capture[]> {
  const url = `${CDX}?url=njlottery.com/api/v1/instant-games/games*&output=json&filter=statuscode:200&fl=timestamp,original,length`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Internet Archive CDX responded ${res.status}`);
  const rows = (await res.json()) as string[][];
  const caps = rows.slice(1)
    .filter(([, original, length]) => original.includes('size=1000') && Number(length) > 20_000)
    .map(([timestamp, original]) => ({ timestamp, original }));
  // One capture per UTC day is plenty.
  const byDay = new Map<string, Capture>();
  for (const c of caps.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) if (!byDay.has(c.timestamp.slice(0, 8))) byDay.set(c.timestamp.slice(0, 8), c);
  return [...byDay.values()];
}

export async function backfillFromArchive(db: DB, opts: { log?: (m: string) => void; delayMs?: number; fetchImpl?: typeof fetch } = {}) {
  const { log = console.log, delayMs = 3000, fetchImpl = fetch } = opts;
  const caps = await listCaptures(fetchImpl);
  log(`Found ${caps.length} archived daily captures of the official API.`);
  const results: Array<{ timestamp: string; status: string; error?: string }> = [];
  for (const c of caps) {
    const url = `https://web.archive.org/web/${c.timestamp}id_/${c.original}`;
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = ingestPayload(db, { body, observedAt: captureTime(c.timestamp), source: 'archive', trigger: 'backfill', httpStatus: res.status, computeEvents: false });
      log(`${c.timestamp}: ${r.status}${r.error ? ` — ${r.error.split('\n')[0]}` : ''}`);
      results.push({ timestamp: c.timestamp, status: r.status, error: r.error });
    } catch (e) {
      log(`${c.timestamp}: fetch failed — ${(e as Error).message}`);
      results.push({ timestamp: c.timestamp, status: 'fetch_failed', error: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const events = rebuildChangeEvents(db);
  log(`Rebuilt ${events} change events from snapshot history.`);
  return results;
}
