#!/usr/bin/env tsx
/**
 * Pipeline health check, run by the scheduled workflow after each update.
 *   tsx health.ts [--markdown <file>]     exit 0 = healthy, 1 = needs attention
 * The workflow opens (or updates) a GitHub issue labeled `pipeline-health` while this fails and closes it
 * when it passes again, so a broken update is noticed instead of only showing up as a stale-data banner.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDatabase, SOURCES, type DB } from '@nj/database';

const HOUR = 3_600_000;

export interface HealthOptions {
  /** No successful check of njlottery.com for this long counts as unhealthy (matches the site's stale banner). */
  staleAfterMs?: number;
  /** This many official runs in a row failing counts as unhealthy, even before the data goes stale. */
  consecutiveFailures?: number;
  /** More out-of-date responses than this within 24 hours suggests NJ's servers are misbehaving. */
  maxStaleResponsesPerDay?: number;
}

export interface HealthReport {
  ok: boolean;
  checkedAt: number;
  problems: string[];
  lastSuccessfulCheckAt: number | null;
  recentRuns: Array<{ at: number; status: string; error: string | null }>;
}

interface Run {
  started_at: number;
  status: string;
  error: string | null;
  id: number;
}

export function checkHealth(db: DB, now = Date.now(), o: HealthOptions = {}): HealthReport {
  const staleAfterMs = o.staleAfterMs ?? 36 * HOUR;
  const consecutive = o.consecutiveFailures ?? 3;
  const maxStale = o.maxStaleResponsesPerDay ?? 3;
  const runs = db
    .prepare(
      `SELECT r.id, r.started_at, r.status, r.error FROM update_runs r JOIN data_sources s ON s.id = r.source_id
       WHERE s.key = ? AND r.status != 'running' ORDER BY r.started_at DESC, r.id DESC LIMIT 50`,
    )
    .all(SOURCES.official.key) as unknown as Run[];
  const problems: string[] = [];
  const lastOk = runs.find((r) => r.status === 'success' || r.status === 'unchanged' || r.status === 'stale');

  if (!runs.length) problems.push('No update of njlottery.com has been attempted yet.');
  else if (!lastOk) problems.push('No update of njlottery.com has ever succeeded.');
  else if (now - lastOk.started_at > staleAfterMs) {
    problems.push(`The last successful check of njlottery.com was ${Math.round((now - lastOk.started_at) / HOUR)} hours ago (limit ${Math.round(staleAfterMs / HOUR)} h).`);
  }

  const head = runs.slice(0, consecutive);
  if (head.length === consecutive && head.every((r) => r.status === 'failed')) {
    problems.push(`The last ${consecutive} updates failed. Latest error: ${head[0].error?.split('\n')[0] ?? 'unknown'}`);
  }

  const staleToday = runs.filter((r) => r.status === 'stale' && now - r.started_at <= 24 * HOUR).length;
  if (staleToday > maxStale) problems.push(`njlottery.com returned ${staleToday} out-of-date responses in the last 24 hours.`);

  // NJ revising a game's prize structure is rare and worth a human look; only the newest data run counts,
  // so the issue closes again on the next normal update.
  const latest = db
    .prepare(`SELECT r.id FROM update_runs r WHERE r.status = 'success' AND EXISTS (SELECT 1 FROM game_snapshots g WHERE g.run_id = r.id) ORDER BY r.observed_at DESC, r.id DESC LIMIT 1`)
    .get() as { id: number } | undefined;
  if (latest) {
    const revisions = db
      .prepare(`SELECT e.message, g.name FROM change_events e LEFT JOIN games g ON g.game_id = e.game_id WHERE e.run_id = ? AND e.kind = 'structure_changed'`)
      .all(latest.id) as Array<{ message: string; name: string | null }>;
    if (revisions.length) {
      const sample = revisions.slice(0, 5).map((r) => `${r.name ?? 'unknown game'}: ${r.message}`).join(' ');
      problems.push(`NJ revised official prize data in the latest update (${revisions.length} change(s)), which is unusual. ${sample}`);
    }
  }

  return {
    ok: problems.length === 0,
    checkedAt: now,
    problems,
    lastSuccessfulCheckAt: lastOk?.started_at ?? null,
    recentRuns: runs.slice(0, 10).map((r) => ({ at: r.started_at, status: r.status, error: r.error })),
  };
}

export function healthMarkdown(r: HealthReport): string {
  const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
  const lines = [
    r.ok ? '**The data pipeline is healthy.**' : '**The data pipeline needs attention.** The site keeps serving the last good data with a staleness warning.',
    '',
    ...r.problems.map((p) => `- ${p}`),
    '',
    `Last successful check of njlottery.com: ${r.lastSuccessfulCheckAt ? iso(r.lastSuccessfulCheckAt) : 'never'}`,
    '',
    '| Started (UTC) | Status | Error |',
    '|---|---|---|',
    ...r.recentRuns.map((x) => `| ${iso(x.at)} | ${x.status} | ${(x.error ?? '').split('\n')[0].replace(/\|/g, '\\|').slice(0, 200)} |`),
    '',
    `_Checked ${iso(r.checkedAt)} by \`packages/scraper/src/health.ts\`. This issue is opened, updated and closed automatically._`,
  ];
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--markdown');
  const out = i > 0 ? process.argv[i + 1] : undefined;
  const db = openDatabase();
  const report = checkHealth(db);
  db.close();
  if (out) writeFileSync(out, healthMarkdown(report));
  console.log(report.ok ? '[health] ok' : `[health] needs attention:\n${report.problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(report.ok ? 0 : 1);
}
