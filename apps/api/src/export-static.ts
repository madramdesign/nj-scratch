#!/usr/bin/env tsx
/**
 * Export the API as static JSON files for hosting without a server (GitHub Pages).
 *   tsx apps/api/src/export-static.ts <outDir>
 * Files are rendered through the real Hono routes, so they are byte-identical to live API responses.
 * `normalized.json` lets the browser re-score games when the user changes weights or the major threshold.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase } from '@nj/database';
import { createApp } from './app.ts';
import { DashboardService } from './service.ts';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: export-static.ts <outDir>');
  process.exit(2);
}

const db = openDatabase();
const service = new DashboardService(db);
const { app } = createApp({ db, service });

async function save(route: string, file: string) {
  const res = await app.request(route);
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status}`);
  const path = join(outDir, 'api', file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, await res.text());
}

await save('/api/games', 'games.json');
await save('/api/meta', 'meta.json');
await save('/api/status', 'status.json');
await save('/api/calendar', 'calendar.json');
await save('/api/updates', 'updates.json');
await save('/api/changes?limit=1000', 'changes.json');
// Notable events are rare (a few per update), so the hosted site can keep far more of them than of all events.
await save('/api/changes?notable=1&limit=5000', 'changes-notable.json');

const games = service.analyze();

// Feeds live at the site root (feed.xml, feed.json, feeds/price-<dollars>.xml) and need absolute links.
const siteUrl = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : undefined;
if (!siteUrl) console.warn('[export] SITE_URL is not set; feed links will point to http://localhost:8787/.');
const { app: feedApp } = createApp({ db, service, siteUrl: siteUrl ?? 'http://localhost:8787/' });
async function saveFeed(route: string) {
  const res = await feedApp.request(route);
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status}`);
  const path = join(outDir, route.slice(1));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, await res.text());
}
await saveFeed('/feed.xml');
await saveFeed('/feed.json');
for (const cents of [...new Set(games.map((g) => g.metrics.priceCents))]) await saveFeed(`/feeds/price-${cents / 100}.xml`);
for (const g of games) {
  await save(`/api/games/${g.metrics.gameId}`, `games/${g.metrics.gameId}.json`);
  await save(`/api/games/${g.metrics.gameId}/history`, `games/${g.metrics.gameId}/history.json`);
}
const active = games.map((g) => g.metrics.gameId);
const normalized = active.map((id) => service.game(id)).filter(Boolean);
writeFileSync(join(outDir, 'api', 'normalized.json'), JSON.stringify(normalized));
writeFileSync(join(outDir, 'api', 'export.json'), JSON.stringify({ exportedAt: Date.now(), games: active.length }));

db.close();
console.log(`[export] wrote ${games.length} games to ${join(outDir, 'api')}`);
