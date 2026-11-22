import { gzipSync, gunzipSync } from 'node:zlib';
import { normalizeGame, type NormalizedGame, type RawGame } from '@nj/lottery-data';
import { SOURCES, type DB, type SourceKey } from './db.ts';

export interface RunRow {
  id: number;
  source_key: string;
  source_name: string;
  trigger: string;
  started_at: number;
  finished_at: number | null;
  observed_at: number;
  status: 'running' | 'success' | 'unchanged' | 'failed';
  http_status: number | null;
  payload_hash: string | null;
  games_total: number | null;
  games_active: number | null;
  games_rankable: number | null;
  games_invalid: number | null;
  issues_json: string | null;
  error: string | null;
  duration_ms: number | null;
}

type Row = Record<string, any>;

const sourceId = (db: DB, key: SourceKey) => (db.prepare('SELECT id FROM data_sources WHERE key = ?').get(SOURCES[key].key) as { id: number }).id;

export function startRun(db: DB, p: { source: SourceKey; trigger: string; observedAt: number; startedAt?: number }): number {
  const r = db
    .prepare("INSERT INTO update_runs (source_id, trigger, started_at, observed_at, status) VALUES (?, ?, ?, ?, 'running')")
    .run(sourceId(db, p.source), p.trigger, p.startedAt ?? Date.now(), p.observedAt);
  return Number(r.lastInsertRowid);
}

export function finishRun(db: DB, id: number, p: Partial<Omit<RunRow, 'id' | 'source_key' | 'source_name'>> & { status: RunRow['status'] }) {
  const fields = { finished_at: Date.now(), ...p };
  const keys = Object.keys(fields);
  db.prepare(`UPDATE update_runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => (fields as Row)[k] ?? null), id);
}

const RUN_SELECT = `SELECT r.*, s.key AS source_key, s.name AS source_name FROM update_runs r JOIN data_sources s ON s.id = r.source_id`;

export function listRuns(db: DB, limit = 50): RunRow[] {
  return db.prepare(`${RUN_SELECT} ORDER BY r.started_at DESC, r.id DESC LIMIT ?`).all(limit) as unknown as RunRow[];
}

/** The run whose snapshots represent the newest data we have (by observation time). */
export function latestDataRun(db: DB): RunRow | undefined {
  return db
    .prepare(`${RUN_SELECT} WHERE r.status = 'success' AND EXISTS (SELECT 1 FROM game_snapshots g WHERE g.run_id = r.id) ORDER BY r.observed_at DESC, r.id DESC LIMIT 1`)
    .get() as unknown as RunRow | undefined;
}

export function lastRunWithStatus(db: DB, statuses: RunRow['status'][]): RunRow | undefined {
  return db.prepare(`${RUN_SELECT} WHERE r.status IN (${statuses.map(() => '?').join(',')}) ORDER BY r.started_at DESC, r.id DESC LIMIT 1`).get(...statuses) as unknown as RunRow | undefined;
}

export function hasPayload(db: DB, hash: string): boolean {
  return !!db.prepare('SELECT 1 FROM raw_payloads WHERE payload_hash = ?').get(hash);
}

export function saveRawPayload(db: DB, runId: number, hash: string, body: string, fetchedAt: number) {
  db.prepare('INSERT OR IGNORE INTO raw_payloads (run_id, payload_hash, fetched_at, body_gzip) VALUES (?, ?, ?, ?)').run(runId, hash, fetchedAt, gzipSync(body));
}

export function loadRawPayload(db: DB, hash: string): string | null {
  const r = db.prepare('SELECT body_gzip FROM raw_payloads WHERE payload_hash = ?').get(hash) as { body_gzip: Uint8Array } | undefined;
  return r ? gunzipSync(r.body_gzip).toString('utf8') : null;
}

export function upsertGame(db: DB, g: NormalizedGame, observedAt: number) {
  db.prepare(
    `INSERT INTO games (game_id, game_number, name, price_cents, launch_date, disable_date, total_tickets_printed, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET
       name = CASE WHEN excluded.last_seen_at >= games.last_seen_at THEN excluded.name ELSE games.name END,
       price_cents = CASE WHEN excluded.last_seen_at >= games.last_seen_at THEN excluded.price_cents ELSE games.price_cents END,
       launch_date = COALESCE(excluded.launch_date, games.launch_date),
       disable_date = CASE WHEN excluded.last_seen_at >= games.last_seen_at THEN excluded.disable_date ELSE games.disable_date END,
       total_tickets_printed = COALESCE(excluded.total_tickets_printed, games.total_tickets_printed),
       first_seen_at = MIN(games.first_seen_at, excluded.first_seen_at),
       last_seen_at = MAX(games.last_seen_at, excluded.last_seen_at)`,
  ).run(g.gameId, g.gameNumber, g.name, g.priceCents, g.launchDate, g.disableDate, g.totalTicketsPrinted, observedAt, observedAt);
  const isLatest = (db.prepare('SELECT last_seen_at FROM games WHERE game_id = ?').get(g.gameId) as { last_seen_at: number }).last_seen_at === observedAt;
  if (isLatest) {
    db.prepare('DELETE FROM prize_tiers WHERE game_id = ?').run(g.gameId);
    const ins = db.prepare('INSERT INTO prize_tiers (game_id, tier_number, prize_cents, advertised_cents, description, tier_type, original_count) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const t of g.tiers) ins.run(g.gameId, t.tierNumber, t.prizeCents, t.advertisedCents, t.description, t.tierType, t.original);
  }
}

export function insertSnapshot(db: DB, runId: number, observedAt: number, g: NormalizedGame): number {
  const top = g.tiers[0];
  const r = db
    .prepare(
      `INSERT INTO game_snapshots (run_id, game_id, observed_at, name, status, validation_status, price_cents, launch_date, start_distribution_date,
         end_distribution_date, disable_date, total_tickets_printed, top_prize_cents, top_prize_label, data_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, g.gameId, observedAt, g.name, g.status, g.validationStatus, g.priceCents, g.launchDate, g.startDistributionDate, g.endDistributionDate, g.disableDate, g.totalTicketsPrinted, top?.prizeCents ?? null, top?.description ?? null, g.dataHash);
  const id = Number(r.lastInsertRowid);
  const ins = db.prepare(
    `INSERT INTO prize_snapshots (snapshot_id, tier_number, prize_cents, description, tier_type, original_count, paid_count, claimed_count, remaining_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const t of g.tiers) ins.run(id, t.tierNumber, t.prizeCents, t.description, t.tierType, t.original, t.paid, t.claimed, t.remaining);
  return id;
}

function rowToRawGame(s: Row, tiers: Row[]): RawGame {
  return {
    gameId: s.game_id,
    gameName: s.name,
    validationStatus: s.validation_status,
    ticketPrice: s.price_cents,
    launchDate: s.launch_date,
    startDistributionDate: s.start_distribution_date,
    endDistributionDate: s.end_distribution_date,
    disableDate: s.disable_date,
    totalTicketsPrinted: s.total_tickets_printed,
    prizeTiers: tiers.map((t) => ({
      tierNumber: t.tier_number,
      prizeAmount: t.prize_cents,
      winningTickets: t.original_count,
      paidTickets: t.paid_count,
      claimedTickets: t.claimed_count,
      prizeDescription: t.description,
      originalTierNumber: t.original_tier_number,
      tierType: t.tier_type,
    })),
  };
}

function tiersBySnapshot(db: DB, snapshotIds: number[]): Map<number, Row[]> {
  const out = new Map<number, Row[]>();
  if (!snapshotIds.length) return out;
  const rows = db.prepare(`SELECT * FROM prize_snapshots WHERE snapshot_id IN (${snapshotIds.map(() => '?').join(',')}) ORDER BY tier_number`).all(...snapshotIds) as Row[];
  for (const r of rows) out.set(r.snapshot_id, [...(out.get(r.snapshot_id) ?? []), r]);
  return out;
}

export interface StoredGame {
  snapshotId: number;
  observedAt: number;
  game: NormalizedGame;
}

/** Reconstruct the normalized games of a run. Status is evaluated at `statusAt` (default: observation time). */
export function loadRunGames(db: DB, runId: number, statusAt?: number): StoredGame[] {
  const snaps = db.prepare('SELECT * FROM game_snapshots WHERE run_id = ?').all(runId) as Row[];
  const tiers = tiersBySnapshot(db, snaps.map((s) => s.id));
  return snaps.map((s) => ({ snapshotId: s.id, observedAt: s.observed_at, game: normalizeGame(rowToRawGame(s, tiers.get(s.id) ?? []), statusAt ?? s.observed_at) }));
}

export function previousSnapshot(db: DB, gameId: string, before: number): StoredGame | undefined {
  const s = db.prepare('SELECT * FROM game_snapshots WHERE game_id = ? AND observed_at < ? ORDER BY observed_at DESC, id DESC LIMIT 1').get(gameId, before) as Row | undefined;
  if (!s) return undefined;
  const t = tiersBySnapshot(db, [s.id]);
  return { snapshotId: s.id, observedAt: s.observed_at, game: normalizeGame(rowToRawGame(s, t.get(s.id) ?? []), s.observed_at) };
}

export function previousScore(db: DB, gameId: string, before: number): { score: number | null; label: string | null } | undefined {
  return db.prepare('SELECT score, label FROM scoring_snapshots WHERE game_id = ? AND observed_at < ? ORDER BY observed_at DESC LIMIT 1').get(gameId, before) as any;
}

export interface ScoringRowInput {
  snapshotId: number;
  runId: number;
  gameId: string;
  observedAt: number;
  methodologyVersion: number;
  score: number | null;
  rank: number | null;
  label: string;
  currentEvCents: number | null;
  currentReturn: number | null;
  originalReturn: number | null;
  topRemaining: number;
  topOriginal: number;
  majorRemaining: number;
  majorOriginal: number;
  prizesRemaining: number;
  valueRemainingCents: number;
  ticketsRemainingEst: number | null;
  components: unknown;
}

export function insertScoring(db: DB, s: ScoringRowInput) {
  db.prepare(
    `INSERT OR REPLACE INTO scoring_snapshots (snapshot_id, run_id, game_id, observed_at, methodology_version, score, rank, label, current_ev_cents, current_return,
       original_return, top_remaining, top_original, major_remaining, major_original, prizes_remaining, value_remaining_cents, tickets_remaining_est, components_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.snapshotId, s.runId, s.gameId, s.observedAt, s.methodologyVersion, s.score, s.rank, s.label, s.currentEvCents, s.currentReturn,
    s.originalReturn, s.topRemaining, s.topOriginal, s.majorRemaining, s.majorOriginal, s.prizesRemaining, s.valueRemainingCents, s.ticketsRemainingEst,
    JSON.stringify(s.components),
  );
}

export interface EventInput {
  runId: number;
  gameId: string;
  observedAt: number;
  kind: string;
  severity: string;
  message: string;
  tierNumber?: number;
  delta?: number;
}

export function insertEvents(db: DB, events: EventInput[]) {
  const ins = db.prepare('INSERT INTO change_events (run_id, game_id, observed_at, kind, severity, message, tier_number, delta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const e of events) ins.run(e.runId, e.gameId, e.observedAt, e.kind, e.severity, e.message, e.tierNumber ?? null, e.delta ?? null);
}

export function listEvents(db: DB, p: { gameId?: string; gameIds?: string[]; since?: number; limit?: number; runId?: number } = {}) {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (p.gameId) { where.push('e.game_id = ?'); args.push(p.gameId); }
  if (p.gameIds) { where.push(`e.game_id IN (${p.gameIds.map(() => '?').join(',') || "''"})`); args.push(...p.gameIds); }
  if (p.since) { where.push('e.observed_at >= ?'); args.push(p.since); }
  if (p.runId) { where.push('e.run_id = ?'); args.push(p.runId); }
  const sql = `SELECT e.*, g.name AS game_name, g.game_number, g.price_cents FROM change_events e LEFT JOIN games g ON g.game_id = e.game_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.observed_at DESC, e.id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, p.limit ?? 200) as Row[];
}

export function gameHistory(db: DB, gameId: string) {
  return db
    .prepare(
      `SELECT s.observed_at, s.score, s.rank, s.label, s.current_ev_cents, s.current_return, s.original_return, s.top_remaining, s.top_original,
              s.major_remaining, s.major_original, s.prizes_remaining, s.value_remaining_cents, s.tickets_remaining_est, ds.key AS source_key
       FROM scoring_snapshots s JOIN update_runs r ON r.id = s.run_id JOIN data_sources ds ON ds.id = r.source_id
       WHERE s.game_id = ? ORDER BY s.observed_at`,
    )
    .all(gameId) as Row[];
}

export function deleteEventsForGames(db: DB, gameIds: string[]) {
  if (!gameIds.length) return;
  db.prepare(`DELETE FROM change_events WHERE game_id IN (${gameIds.map(() => '?').join(',')})`).run(...gameIds);
}

export function snapshotTimeline(db: DB, gameId: string): Array<{ snapshotId: number; runId: number; observedAt: number }> {
  return (db.prepare('SELECT id, run_id, observed_at FROM game_snapshots WHERE game_id = ? ORDER BY observed_at, id').all(gameId) as Row[]).map((r) => ({ snapshotId: r.id, runId: r.run_id, observedAt: r.observed_at }));
}

export function loadSnapshot(db: DB, snapshotId: number): NormalizedGame {
  const s = db.prepare('SELECT * FROM game_snapshots WHERE id = ?').get(snapshotId) as Row;
  const t = tiersBySnapshot(db, [snapshotId]);
  return normalizeGame(rowToRawGame(s, t.get(snapshotId) ?? []), s.observed_at);
}

export function scoreAtSnapshot(db: DB, snapshotId: number): { score: number | null; label: string | null } | undefined {
  return db.prepare('SELECT score, label FROM scoring_snapshots WHERE snapshot_id = ?').get(snapshotId) as any;
}

export function allGameIds(db: DB): string[] {
  return (db.prepare('SELECT game_id FROM games').all() as Row[]).map((r) => r.game_id);
}

// Watchlist
export function getWatchlist(db: DB): Array<{ game_id: string; added_at: number; score_at_add: number | null; note: string | null }> {
  return db.prepare('SELECT * FROM watchlist ORDER BY added_at DESC').all() as any;
}
export function addToWatchlist(db: DB, gameId: string, scoreAtAdd: number | null, note?: string) {
  db.prepare('INSERT INTO watchlist (game_id, added_at, score_at_add, note) VALUES (?, ?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET note = COALESCE(excluded.note, watchlist.note)').run(gameId, Date.now(), scoreAtAdd, note ?? null);
}
export function removeFromWatchlist(db: DB, gameId: string) {
  db.prepare('DELETE FROM watchlist WHERE game_id = ?').run(gameId);
}

export function gameExists(db: DB, gameId: string): boolean {
  return !!db.prepare('SELECT 1 FROM games WHERE game_id = ?').get(gameId);
}

export function dbStats(db: DB) {
  const c = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const span = db.prepare("SELECT MIN(observed_at) AS first, MAX(observed_at) AS last, COUNT(DISTINCT observed_at) AS points FROM game_snapshots").get() as Row;
  return { games: c('games'), snapshots: c('game_snapshots'), prizeSnapshots: c('prize_snapshots'), runs: c('update_runs'), events: c('change_events'), historyFirst: span.first, historyLast: span.last, historyPoints: span.points };
}
