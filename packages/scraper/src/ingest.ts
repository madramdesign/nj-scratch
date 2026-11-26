import { parseGamesResponse, type NormalizedGame, type ParseReport } from '@nj/lottery-data';
import { analyzeGames, diffGame, firstSeenEvent, scoreChangeEvent, labelFor, EVENTS_VERSION, type ChangeEvent } from '@nj/analytics';
import {
  allGameIds, deleteEventsForGames, finishRun, hasPayload, insertEvents, insertScoring, insertSnapshot, lastRunWithStatus, loadSnapshot,
  SOURCES, getMeta, setMeta, latestDataRun, previousScore, previousSnapshot, quarantineRun, runPaidTotals, saveRawPayload, scoreAtSnapshot, snapshotTimeline, startRun, transaction, upsertGame,
  type DB, type EventInput, type SourceKey,
} from '@nj/database';

export const METHODOLOGY_VERSION = 1;

export interface IngestInput {
  body: string;
  observedAt: number;
  source: SourceKey;
  trigger: string;
  httpStatus?: number;
  /** Compute change events against the previous snapshot (disable during bulk backfill, then rebuild). */
  computeEvents?: boolean;
}

export interface IngestResult {
  runId: number;
  status: 'success' | 'unchanged' | 'stale' | 'failed';
  report?: ParseReport;
  snapshots?: number;
  events?: number;
  error?: string;
}

/** Upcoming games are stored too (they publish full prize tables before launch), so they can be listed and announced. */
const SNAPSHOT_STATUSES = new Set(['active', 'ended', 'upcoming']);

/**
 * Validate → normalize → snapshot → score → detect changes, all in one transaction.
 * On any validation error the run is recorded as FAILED and nothing else is written,
 * so the dashboard keeps showing the last good data (clearly marked with its age).
 */
export function ingestPayload(db: DB, input: IngestInput): IngestResult {
  const startedAt = Date.now();
  const runId = startRun(db, { source: input.source, trigger: input.trigger, observedAt: input.observedAt, startedAt });
  let report: ParseReport | undefined;
  try {
    let json: unknown;
    try {
      json = JSON.parse(input.body);
    } catch {
      throw new Error('Response body is not valid JSON.');
    }
    const parsed = parseGamesResponse(json, { now: input.observedAt });
    report = parsed.report;
    const reportFields = {
      http_status: input.httpStatus ?? null,
      payload_hash: report.payloadHash,
      games_total: report.totalGames,
      games_active: report.activeGames,
      games_rankable: report.rankableActiveGames,
      games_invalid: report.invalidActiveGames,
      issues_json: JSON.stringify(report.issues.filter((i) => i.severity !== 'info' && parsed.games.find((g) => g.gameId === i.gameId)?.status === 'active')),
    };

    if (hasPayload(db, report.payloadHash)) {
      finishRun(db, runId, { status: 'unchanged', ...reportFields, duration_ms: Date.now() - startedAt });
      return { runId, status: 'unchanged', report };
    }

    const latest = latestDataRun(db);
    const isFirstData = !latest;
    if (input.source === 'official' && latest && latest.source_key === SOURCES.official.key && latest.observed_at < input.observedAt) {
      const toCheck = parsed.games.filter((g) => SNAPSHOT_STATUSES.has(g.status) && g.tiers.length > 0);
      const behind = paidShortfall(runPaidTotals(db, latest.id), toCheck);
      if (behind > 0) {
        const error = staleMessage(behind);
        saveRawPayload(db, runId, report.payloadHash, input.body, input.observedAt);
        finishRun(db, runId, { status: 'stale', ...reportFields, error, duration_ms: Date.now() - startedAt });
        return { runId, status: 'stale', report, error };
      }
    }
    const result = transaction(db, () => {
      saveRawPayload(db, runId, report!.payloadHash, input.body, input.observedAt);
      const snapIds = new Map<string, number>();
      const toSnapshot = parsed.games.filter((g) => SNAPSHOT_STATUSES.has(g.status) && g.tiers.length > 0);
      for (const g of toSnapshot) {
        upsertGame(db, g, input.observedAt);
        snapIds.set(g.gameId, insertSnapshot(db, runId, input.observedAt, g));
      }
      const analyzed = analyzeGames(parsed.games);
      for (const a of analyzed) {
        const snapshotId = snapIds.get(a.metrics.gameId);
        if (!snapshotId) continue;
        const m = a.metrics;
        insertScoring(db, {
          snapshotId, runId, gameId: m.gameId, observedAt: input.observedAt, methodologyVersion: METHODOLOGY_VERSION,
          score: a.score.score, rank: a.score.rank, label: a.score.label,
          currentEvCents: m.currentEvCents, currentReturn: m.currentReturn, originalReturn: m.originalReturn,
          topRemaining: m.topPrize.remaining, topOriginal: m.topPrize.original,
          majorRemaining: m.major.remaining, majorOriginal: m.major.original,
          prizesRemaining: m.allPrizes.remaining, valueRemainingCents: m.allPrizes.valueRemainingCents,
          ticketsRemainingEst: m.tickets.available ? m.tickets.ticketsRemaining : null,
          components: a.score.components.map((c) => ({ key: c.key, raw: c.raw, percentile: c.percentile, weight: c.weight })),
        });
      }
      let events = 0;
      if (input.computeEvents !== false && !isFirstData) {
        const evts: EventInput[] = [];
        for (const g of toSnapshot) {
          evts.push(...eventsFor(db, g, input.observedAt, runId, analyzed.find((a) => a.metrics.gameId === g.gameId)?.score.score ?? null));
        }
        insertEvents(db, evts);
        events = evts.length;
      }
      return { snapshots: toSnapshot.length, events };
    });

    finishRun(db, runId, { status: 'success', ...reportFields, duration_ms: Date.now() - startedAt });
    return { runId, status: 'success', report, ...result };
  } catch (e) {
    const error = (e as Error).message;
    finishRun(db, runId, { status: 'failed', error, payload_hash: report?.payloadHash ?? null, http_status: input.httpStatus ?? null, duration_ms: Date.now() - startedAt });
    return { runId, status: 'failed', error, report };
  }
}

/**
 * How many paid tickets a response is behind the previous data, summed over the games present in both.
 * Paid counts only grow, so a positive result means the response is an out-of-date copy (NJ's servers or
 * caches can briefly disagree), not news.
 */
export function paidShortfall(previous: Map<string, number>, games: NormalizedGame[]): number {
  let prev = 0;
  let next = 0;
  for (const g of games) {
    const p = previous.get(g.gameId);
    if (p == null) continue;
    prev += p;
    next += g.tiers.reduce((n, t) => n + t.paid, 0);
  }
  return prev - next;
}

const staleMessage = (behind: number) =>
  `njlottery.com returned an out-of-date copy of the data (${behind.toLocaleString('en-US')} fewer paid prizes than the data already stored); it was not used.`;

/**
 * Find official runs whose data went backwards compared with the run before them, withdraw them, and
 * rebuild change events. Safe to run repeatedly; returns the withdrawn run ids.
 */
export function quarantineStaleRuns(db: DB): number[] {
  const runs = db
    .prepare(
      `SELECT r.id FROM update_runs r JOIN data_sources s ON s.id = r.source_id
       WHERE s.key = ? AND r.status = 'success' AND EXISTS (SELECT 1 FROM game_snapshots g WHERE g.run_id = r.id)
       ORDER BY r.observed_at, r.id`,
    )
    .all(SOURCES.official.key) as { id: number }[];
  const withdrawn: number[] = [];
  let accepted: Map<string, number> | null = null;
  for (const { id } of runs) {
    const totals = runPaidTotals(db, id);
    if (accepted) {
      let prev = 0;
      let next = 0;
      for (const [game, paid] of totals) {
        const p = accepted.get(game);
        if (p == null) continue;
        prev += p;
        next += paid;
      }
      if (next < prev) {
        withdrawn.push(id);
        transaction(db, () => quarantineRun(db, id, staleMessage(prev - next)));
        continue;
      }
    }
    accepted = totals;
  }
  if (withdrawn.length) rebuildChangeEvents(db);
  return withdrawn;
}

function eventsFor(db: DB, g: NormalizedGame, observedAt: number, runId: number, score: number | null): EventInput[] {
  const prev = previousSnapshot(db, g.gameId, observedAt);
  const out: ChangeEvent[] = [];
  if (!prev) {
    const first = firstSeenEvent(g);
    if (first) out.push(first);
  } else {
    out.push(...diffGame(prev.game, g));
    const ps = previousScore(db, g.gameId, observedAt);
    const sc = scoreChangeEvent(g.gameId, ps?.score ?? null, score);
    if (sc) out.push(sc);
    const newLabel = labelFor(score);
    if (ps?.label && score != null && ps.label !== newLabel && newLabel !== 'unrated') {
      out.push({ gameId: g.gameId, kind: 'score_changed', severity: 'notable', message: `Profile changed from ${ps.label} to ${newLabel}.` });
    }
  }
  return out.map((e) => ({ ...e, runId, observedAt }));
}

/** Recompute all change events chronologically from stored snapshots (used after backfilling out of order). */
export function rebuildChangeEvents(db: DB): number {
  const ids = allGameIds(db);
  let total = 0;
  transaction(db, () => {
    deleteEventsForGames(db, ids);
    const firstObserved = (db.prepare('SELECT MIN(observed_at) AS t FROM game_snapshots').get() as { t: number | null }).t;
    for (const id of ids) {
      const tl = snapshotTimeline(db, id);
      const evts: EventInput[] = [];
      let prev: NormalizedGame | undefined;
      let prevScore: { score: number | null; label: string | null } | undefined;
      for (const s of tl) {
        const g = loadSnapshot(db, s.snapshotId);
        const sc = scoreAtSnapshot(db, s.snapshotId);
        const base = { runId: s.runId, observedAt: s.observedAt };
        if (!prev) {
          const first = s.observedAt !== firstObserved ? firstSeenEvent(g) : null;
          if (first) evts.push({ ...first, ...base });
        } else {
          for (const e of diffGame(prev, g)) evts.push({ ...e, ...base });
          const ch = scoreChangeEvent(id, prevScore?.score ?? null, sc?.score ?? null);
          if (ch) evts.push({ ...ch, ...base });
          if (prevScore?.label && sc?.label && prevScore.label !== sc.label && sc.label !== 'unrated') {
            evts.push({ ...base, gameId: id, kind: 'score_changed', severity: 'notable', message: `Profile changed from ${prevScore.label} to ${sc.label}.` });
          }
        }
        prev = g;
        if (sc) prevScore = sc;
      }
      insertEvents(db, evts);
      total += evts.length;
    }
    setMeta(db, 'events_version', String(EVENTS_VERSION));
  });
  return total;
}

export { lastRunWithStatus };

/** Rebuild stored change events once if they were derived by an older version of the event rules. */
export function upgradeChangeEvents(db: DB): number | null {
  const stored = Number(getMeta(db, 'events_version') ?? 1);
  if (stored >= EVENTS_VERSION) return null;
  return rebuildChangeEvents(db);
}
