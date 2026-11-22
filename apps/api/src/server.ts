import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@nj/database';
import { runUpdate } from '@nj/scraper';
import { createApp } from './app.ts';
import { startScheduler } from './scheduler.ts';

const db = openDatabase();
const { app, service } = createApp({ db, adminToken: process.env.ADMIN_TOKEN });

// In production, serve the built dashboard from the same origin.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  const root = relative(process.cwd(), webDist);
  app.use('/*', serveStatic({ root }));
  const index = readFileSync(resolve(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(index)));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`[api] listening on http://localhost:${port}`));

if (process.env.DISABLE_SCHEDULER !== '1') {
  startScheduler({
    db,
    intervalMs: Number(process.env.UPDATE_INTERVAL_HOURS ?? 6) * 3600_000,
    update: () => runUpdate(db, { trigger: 'scheduled', log: (m) => console.log(`[scheduler] ${m}`) }),
    onUpdated: () => service.invalidate(),
  });
}
