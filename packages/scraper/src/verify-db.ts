/**
 * Safety check before a database is saved as a backup: the file must pass SQLite's integrity
 * check, and no append-only history table may have fewer rows than the previously saved copy.
 * Usage: `tsx verify-db.ts <new.db> [previous.db]` — exits non-zero when the new copy looks damaged.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export const APPEND_ONLY_TABLES = ['update_runs', 'raw_payloads', 'game_snapshots', 'prize_snapshots', 'scoring_snapshots'] as const;

function rowCounts(path: string): Record<string, number> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const counts: Record<string, number> = {};
    for (const t of APPEND_ONLY_TABLES) counts[t] = Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
    return counts;
  } finally {
    db.close();
  }
}

/** Returns a list of problems; empty means the new copy is safe to save. */
export function verifyDatabase(nextPath: string, previousPath?: string | null): string[] {
  if (!existsSync(nextPath)) return [`${nextPath} does not exist`];
  const problems: string[] = [];
  let next: Record<string, number>;
  try {
    const db = new DatabaseSync(nextPath, { readOnly: true });
    try {
      const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
      const msgs = rows.map((r) => r.integrity_check).filter((m) => m !== 'ok');
      if (msgs.length) problems.push(`integrity check failed: ${msgs.slice(0, 5).join('; ')}`);
    } finally {
      db.close();
    }
    next = rowCounts(nextPath);
  } catch (e) {
    return [...problems, `cannot read ${nextPath}: ${(e as Error).message}`];
  }
  if (next.update_runs === 0) problems.push('update_runs is empty');
  if (previousPath && existsSync(previousPath)) {
    let prev: Record<string, number> | null = null;
    try {
      prev = rowCounts(previousPath);
    } catch {
      // The previous copy is unreadable; nothing to compare against.
    }
    if (prev) for (const t of APPEND_ONLY_TABLES) if (next[t] < prev[t]) problems.push(`${t} shrank from ${prev[t]} to ${next[t]} rows`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [nextPath, previousPath] = process.argv.slice(2);
  if (!nextPath) {
    console.error('usage: verify-db <new.db> [previous.db]');
    process.exit(2);
  }
  const problems = verifyDatabase(nextPath, previousPath);
  if (problems.length) {
    for (const p of problems) console.error(`[verify-db] ${p}`);
    process.exit(1);
  }
  console.log(`[verify-db] ok: ${JSON.stringify(rowCounts(nextPath))}`);
}
