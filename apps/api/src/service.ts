import { analyzeGames, COMPONENTS, DEFAULT_MAJOR_THRESHOLD_CENTS, DEFAULT_WEIGHTS, MAJOR_THRESHOLDS_CENTS, normalizeWeights, type AnalyzedGame, type Weights } from '@nj/analytics';
import {
  dbStats, gameHistory, getWatchlist, lastRunWithStatus, latestDataRun, listEvents, listRuns, loadRunGames, SOURCES, type DB, type RunRow,
} from '@nj/database';
import type { NormalizedGame } from '@nj/lottery-data';

export const STALE_AFTER_MS = Number(process.env.STALE_AFTER_HOURS ?? 36) * 3600_000;

export interface AnalysisOptions {
  majorThresholdCents: number;
  weights: Weights;
}

export const DEFAULT_OPTIONS: AnalysisOptions = { majorThresholdCents: DEFAULT_MAJOR_THRESHOLD_CENTS, weights: DEFAULT_WEIGHTS };

interface Current {
  run: RunRow;
  games: NormalizedGame[];
  snapshotIds: Map<string, number>;
}

/** Reads from the database and caches analysis per (data run, options). */
export class DashboardService {
  private current?: { key: string; value: Current };
  private analysisCache = new Map<string, AnalyzedGame[]>();

  constructor(private db: DB, private now: () => number = Date.now) {}

  invalidate() {
    this.current = undefined;
    this.analysisCache.clear();
  }

  private loadCurrent(): Current | undefined {
    const run = latestDataRun(this.db);
    if (!run) return undefined;
    // Status (active/ended) depends on today's date, so include the day in the cache key.
    const key = `${run.id}:${Math.floor(this.now() / 86_400_000)}`;
    if (this.current?.key !== key) {
      const stored = loadRunGames(this.db, run.id, this.now());
      this.current = { key, value: { run, games: stored.map((s) => s.game), snapshotIds: new Map(stored.map((s) => [s.game.gameId, s.snapshotId])) } };
      this.analysisCache.clear();
    }
    return this.current.value;
  }

  analyze(opts: AnalysisOptions = DEFAULT_OPTIONS): AnalyzedGame[] {
    const cur = this.loadCurrent();
    if (!cur) return [];
    const key = JSON.stringify(opts);
    let res = this.analysisCache.get(key);
    if (!res) {
      res = analyzeGames(cur.games, { majorThresholdCents: opts.majorThresholdCents, weights: opts.weights });
      if (this.analysisCache.size > 50) this.analysisCache.clear();
      this.analysisCache.set(key, res);
    }
    return res;
  }

  game(id: string): NormalizedGame | undefined {
    return this.loadCurrent()?.games.find((g) => g.gameId === id || g.gameNumber === id);
  }

  status() {
    const now = this.now();
    const data = latestDataRun(this.db);
    const lastOk = this.db.prepare(`SELECT r.started_at, r.status FROM update_runs r JOIN data_sources s ON s.id = r.source_id WHERE s.key = ? AND r.status IN ('success','unchanged') ORDER BY r.started_at DESC LIMIT 1`).get(SOURCES.official.key) as { started_at: number; status: string } | undefined;
    const lastOfficialOk = lastOk?.started_at;
    const lastAttempt = listRuns(this.db, 1)[0];
    const lastFailed = lastRunWithStatus(this.db, ['failed']);
    const verifiedAt = lastOfficialOk ?? null;
    const ageMs = verifiedAt ? now - verifiedAt : null;
    const analyzed = this.analyze();
    const warnings: string[] = [];
    if (!data) warnings.push('No data has been loaded yet. Run a refresh.');
    else if (!verifiedAt) warnings.push('Only archived (Internet Archive) data is loaded; no live check of njlottery.com has succeeded yet.');
    else if (ageMs! > STALE_AFTER_MS) warnings.push(`Data was last verified against njlottery.com ${Math.round(ageMs! / 3600_000)} hours ago and may be stale.`);
    if (lastAttempt?.status === 'failed') warnings.push(`The most recent update attempt failed: ${lastAttempt.error?.split('\n')[0]}`);
    if (data?.games_invalid) warnings.push(`${data.games_invalid} active game(s) were excluded because of invalid data.`);
    return {
      now,
      source: { name: SOURCES.official.name, url: SOURCES.official.url, page: 'https://www.njlottery.com/en-us/scratch-offs.html#tab-active' },
      dataAsOf: data?.observed_at ?? null,
      dataSource: data?.source_key ?? null,
      lastVerifiedAt: verifiedAt,
      lastSuccessfulCheck: lastOk ? { at: lastOk.started_at, status: lastOk.status } : null,
      lastAttempt: lastAttempt ? { at: lastAttempt.started_at, status: lastAttempt.status, error: lastAttempt.error, trigger: lastAttempt.trigger } : null,
      lastFailure: lastFailed ? { at: lastFailed.started_at, error: lastFailed.error } : null,
      dataAgeMs: ageMs,
      isStale: ageMs == null || ageMs > STALE_AFTER_MS,
      gamesRetrieved: data?.games_total ?? 0,
      activeGames: data?.games_active ?? 0,
      rankedGames: analyzed.filter((a) => a.score.score != null).length,
      gamesWithMissingData: (data?.games_invalid ?? 0) + analyzed.filter((a) => !a.metrics.tickets.available).length,
      gamesInvalid: data?.games_invalid ?? 0,
      dataIssues: data?.issues_json ? JSON.parse(data.issues_json) : [],
      warnings,
      history: dbStats(this.db),
    };
  }

  /** Per game: time of the most recent non-trivial change and count of changes in the last 30 days. */
  recentChangeIndex(): Map<string, { last: number; count: number }> {
    const since = this.now() - 30 * 86_400_000;
    const rows = this.db
      .prepare(`SELECT game_id, MAX(observed_at) AS last, SUM(CASE WHEN observed_at >= ? THEN 1 ELSE 0 END) AS n FROM change_events WHERE kind != 'game_added' GROUP BY game_id`)
      .all(since) as Array<{ game_id: string; last: number; n: number }>;
    return new Map(rows.map((r) => [r.game_id, { last: r.last, count: r.n }]));
  }

  history(id: string) {
    return gameHistory(this.db, id);
  }

  events(p: Parameters<typeof listEvents>[1]) {
    return listEvents(this.db, p);
  }

  runs(limit = 50) {
    return listRuns(this.db, limit).map(({ issues_json, ...r }) => ({ ...r, issueCount: issues_json ? JSON.parse(issues_json).length : 0 }));
  }

  watchlist() {
    return getWatchlist(this.db);
  }

  meta() {
    return {
      components: COMPONENTS.map(({ key, label, short, description }) => ({ key, label, short, description, defaultWeight: DEFAULT_WEIGHTS[key] })),
      majorThresholdsCents: MAJOR_THRESHOLDS_CENTS,
      defaultMajorThresholdCents: DEFAULT_MAJOR_THRESHOLD_CENTS,
    };
  }
}

export function parseOptions(q: Record<string, string | undefined>): AnalysisOptions {
  const major = q.major ? Math.round(Number(q.major) * 100) : DEFAULT_MAJOR_THRESHOLD_CENTS;
  const weights: Partial<Weights> = {};
  if (q.w) {
    for (const part of q.w.split(',')) {
      const [k, v] = part.split(':');
      if (k && k in DEFAULT_WEIGHTS && v != null && Number.isFinite(Number(v))) weights[k as keyof Weights] = Math.min(100, Math.max(0, Number(v)));
    }
  }
  return {
    majorThresholdCents: Number.isFinite(major) && major > 0 ? major : DEFAULT_MAJOR_THRESHOLD_CENTS,
    weights: normalizeWeights(weights),
  };
}
