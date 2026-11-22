#!/usr/bin/env tsx
/** One-shot update: `npm run scrape`. Exits non-zero when the update fails so cron/launchd can alert. */
import { openDatabase } from '@nj/database';
import { runUpdate } from './update.ts';

const db = openDatabase();
const result = await runUpdate(db, { trigger: 'cli', log: (m) => console.log(`[scrape] ${m}`) });
if (result.report) {
  const r = result.report;
  console.log(`[scrape] games=${r.totalGames} active=${r.activeGames} rankable=${r.rankableActiveGames} invalid=${r.invalidActiveGames}`);
}
process.exit(result.status === 'failed' ? 1 : 0);
