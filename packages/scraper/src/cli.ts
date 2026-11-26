#!/usr/bin/env tsx
/** One-shot update: `npm run scrape`. Exits non-zero when the update fails so cron/launchd can alert. */
import { openDatabase } from '@nj/database';
import { runUpdate } from './update.ts';
import { quarantineStaleRuns, upgradeChangeEvents } from './ingest.ts';

const db = openDatabase();
const withdrawn = quarantineStaleRuns(db);
if (withdrawn.length) console.log(`[scrape] Withdrew ${withdrawn.length} earlier run(s) that held out-of-date data: ${withdrawn.join(', ')}`);
const rebuilt = upgradeChangeEvents(db);
if (rebuilt != null) console.log(`[scrape] Rebuilt ${rebuilt} change events with the current event rules.`);
const result = await runUpdate(db, { trigger: 'cli', log: (m) => console.log(`[scrape] ${m}`) });
if (result.report) {
  const r = result.report;
  console.log(`[scrape] games=${r.totalGames} active=${r.activeGames} rankable=${r.rankableActiveGames} invalid=${r.invalidActiveGames}`);
}
db.close();
process.exit(result.status === 'failed' ? 1 : 0);
