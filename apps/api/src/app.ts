import { Hono } from 'hono';
import { z } from 'zod';
import type { AnalyzedGame } from '@nj/analytics';
import { addToWatchlist, gameExists, removeFromWatchlist, type DB } from '@nj/database';
import { runUpdate, type IngestResult } from '@nj/scraper';
import { DashboardService, parseOptions } from './service.ts';

export const DISCLAIMER =
  'Scratch-off tickets are gambling products and the lottery keeps a house edge. Rankings describe the official remaining-prize data; they are not predictions, ' +
  'and a high score does not mean a ticket is likely to win. Estimated values (tickets remaining, current EV) are this app\'s calculations, not NJ Lottery figures. ' +
  'Prizes may already be won but not yet claimed. If gambling is a problem, call 1-800-GAMBLER.';

/** List view: everything except the per-tier table. */
export function summarize(a: AnalyzedGame) {
  const { tiers, ...m } = a.metrics;
  return { ...m, score: a.score, explanation: a.explanation };
}

type Refresher = (trigger: string) => Promise<IngestResult>;

export interface AppDeps {
  db: DB;
  service?: DashboardService;
  refresh?: Refresher;
  /** Min time between manual refreshes (the NJ API is CDN-cached for 5 minutes anyway). */
  refreshCooldownMs?: number;
  adminToken?: string;
}

const priceParam = z.coerce.number().positive().max(1000);

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const service = deps.service ?? new DashboardService(db);
  const refresh: Refresher = deps.refresh ?? ((trigger) => runUpdate(db, { trigger, log: (m) => console.log(`[update] ${m}`) }));
  const cooldown = deps.refreshCooldownMs ?? 5 * 60_000;
  let lastManualRefresh = 0;
  let inFlight: Promise<IngestResult> | null = null;

  const app = new Hono();

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  const analyzed = (c: { req: { query: () => Record<string, string> } }) => service.analyze(parseOptions(c.req.query()));

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/meta', (c) => c.json({ ...service.meta(), disclaimer: DISCLAIMER }));
  app.get('/api/status', (c) => c.json(service.status()));

  app.get('/api/games', (c) => {
    const games = analyzed(c);
    const recent = service.recentChangeIndex();
    return c.json({
      status: service.status(),
      count: games.length,
      games: games.map((g) => ({ ...summarize(g), lastChangeAt: recent.get(g.metrics.gameId)?.last ?? null, recentChanges: recent.get(g.metrics.gameId)?.count ?? 0 })),
    });
  });

  app.get('/api/games/:id', (c) => {
    const id = c.req.param('id').replace(/^0+/, '');
    const opts = parseOptions(c.req.query());
    const a = service.analyze(opts).find((g) => g.metrics.gameId === id);
    const raw = service.game(id);
    if (!a && !raw) return c.json({ error: `Game ${id} not found among current games.` }, 404);
    return c.json({
      game: a ? { ...a.metrics, score: a.score, explanation: a.explanation } : null,
      normalized: raw ?? null,
      ranked: !!a,
      notRankedReason: a ? null : raw?.status !== 'active' ? `This game is ${raw?.status} (not currently sold), so it is not ranked.` : 'This game has data problems and is excluded from rankings.',
      issues: raw?.issues ?? [],
      events: service.events({ gameId: id, limit: 100 }),
      officialUrl: `https://www.njlottery.com/en-us/scratch-offs/${id.padStart(5, '0')}.html`,
    });
  });

  app.get('/api/games/:id/history', (c) => {
    const id = c.req.param('id').replace(/^0+/, '');
    return c.json({ gameId: id, points: service.history(id) });
  });

  const SORTS: Record<string, (a: AnalyzedGame) => number | null> = {
    score: (a) => a.score.score,
    ev: (a) => a.metrics.currentReturn,
    top: (a) => a.metrics.topRetention,
    topPct: (a) => a.metrics.topPrize.pctRemaining,
    major: (a) => a.metrics.majorRetention,
    majorPct: (a) => a.metrics.major.pctRemaining,
    prizesPct: (a) => a.metrics.allPrizes.pctRemaining,
    value: (a) => a.metrics.valueRetention,
    odds: (a) => (a.metrics.currentOddsAnyOneIn ? 1 / a.metrics.currentOddsAnyOneIn : null),
    profitOdds: (a) => (a.metrics.currentOddsProfitOneIn ? 1 / a.metrics.currentOddsProfitOneIn : null),
  };
  const rank = (games: AnalyzedGame[], by: string, limit = 10, dir: 'desc' | 'asc' = 'desc') => {
    const f = SORTS[by] ?? SORTS.score;
    return games
      .filter((g) => f(g) != null)
      .sort((a, b) => (dir === 'desc' ? f(b)! - f(a)! : f(a)! - f(b)!))
      .slice(0, limit)
      .map(summarize);
  };

  app.get('/api/rankings', (c) => {
    const by = c.req.query('by') ?? 'score';
    if (!(by in SORTS)) return c.json({ error: `Unknown ranking "${by}". Use one of: ${Object.keys(SORTS).join(', ')}` }, 400);
    const limit = z.coerce.number().int().min(1).max(500).catch(100).parse(c.req.query('limit'));
    return c.json({ by, games: rank(analyzed(c), by, limit) });
  });

  app.get('/api/rankings/best', (c) => {
    const games = analyzed(c);
    return c.json({
      overall: rank(games, 'score', 10),
      expectedValue: rank(games, 'ev', 10),
      topPrize: rank(games, 'top', 10),
      majorPrize: rank(games, 'major', 10),
      value: rank(games, 'value', 10),
    });
  });

  app.get('/api/rankings/worst', (c) => {
    const limit = z.coerce.number().int().min(1).max(100).catch(10).parse(c.req.query('limit'));
    return c.json({ games: rank(analyzed(c), 'score', limit, 'asc') });
  });

  app.get('/api/rankings/by-price', (c) => {
    const games = analyzed(c);
    const prices = [...new Set(games.map((g) => g.metrics.priceCents))].sort((a, b) => a - b);
    return c.json({
      prices: prices.map((p) => {
        const peers = games.filter((g) => g.metrics.priceCents === p);
        return { priceCents: p, count: peers.length, best: rank(peers, 'score', 1)[0] ?? null, games: rank(peers, 'score', 100) };
      }),
    });
  });

  app.get('/api/rankings/by-price/:price', (c) => {
    const parsed = priceParam.safeParse(c.req.param('price'));
    if (!parsed.success) return c.json({ error: 'Price must be a positive dollar amount, e.g. 20' }, 400);
    const cents = Math.round(parsed.data * 100);
    const peers = analyzed(c).filter((g) => g.metrics.priceCents === cents);
    return c.json({ priceCents: cents, count: peers.length, best: rank(peers, 'score', 1)[0] ?? null, games: rank(peers, 'score', 100) });
  });

  app.get('/api/statistics', (c) => {
    const games = analyzed(c);
    const ranked = games.filter((g) => g.score.score != null);
    const by = (f: (a: AnalyzedGame) => number | null) => [...ranked].filter((g) => f(g) != null).sort((a, b) => f(b)! - f(a)!)[0];
    const sum = (f: (a: AnalyzedGame) => number) => games.reduce((s, g) => s + f(g), 0);
    const pick = (a?: AnalyzedGame) => (a ? { gameId: a.metrics.gameId, gameNumber: a.metrics.gameNumber, name: a.metrics.name, priceCents: a.metrics.priceCents } : null);
    const bestEv = by((a) => a.metrics.currentReturn);
    const bestTop = by((a) => a.metrics.topPrize.pctRemaining);
    const bestScore = by((a) => a.score.score);
    return c.json({
      activeGames: games.length,
      bestEv: bestEv && { ...pick(bestEv), value: bestEv.metrics.currentReturn, evCents: bestEv.metrics.currentEvCents },
      bestTopPct: bestTop && { ...pick(bestTop), value: bestTop.metrics.topPrize.pctRemaining, remaining: bestTop.metrics.topPrize.remaining, original: bestTop.metrics.topPrize.original },
      bestScore: bestScore && { ...pick(bestScore), value: bestScore.score.score },
      totals: {
        topPrizesRemaining: sum((a) => a.metrics.topPrize.remaining),
        topPrizesOriginal: sum((a) => a.metrics.topPrize.original),
        prizeValueRemainingCents: sum((a) => a.metrics.allPrizes.valueRemainingCents),
        gamesWithNoTopPrize: games.filter((a) => a.metrics.topPrize.remaining === 0).length,
      },
      medianReturn: (() => {
        const r = games.map((g) => g.metrics.currentReturn).filter((x): x is number => x != null).sort((a, b) => a - b);
        return r.length ? r[Math.floor(r.length / 2)] : null;
      })(),
    });
  });

  app.get('/api/updates', (c) => c.json({ status: service.status(), runs: service.runs(100) }));

  app.get('/api/changes', (c) => {
    const since = c.req.query('since') ? Number(c.req.query('since')) : undefined;
    const limit = z.coerce.number().int().min(1).max(1000).catch(200).parse(c.req.query('limit'));
    return c.json({ events: service.events({ since, limit }) });
  });

  // Watchlist
  app.get('/api/watchlist', (c) => {
    const games = analyzed(c);
    const list = service.watchlist();
    const ids = list.map((w) => w.game_id);
    const events = ids.length ? service.events({ gameIds: ids, limit: 200 }) : [];
    return c.json({
      items: list.map((w) => {
        const a = games.find((g) => g.metrics.gameId === w.game_id);
        const history = service.history(w.game_id);
        const prev = history.length >= 2 ? history[history.length - 2] : null;
        return {
          ...w,
          game: a ? summarize(a) : null,
          previousScore: prev?.score ?? null,
          previousObservedAt: prev?.observed_at ?? null,
          events: events.filter((e) => e.game_id === w.game_id).slice(0, 10),
        };
      }),
      alerts: events.filter((e) => e.severity !== 'info').slice(0, 50),
    });
  });

  app.post('/api/watchlist/:id', async (c) => {
    const id = c.req.param('id').replace(/^0+/, '');
    if (!gameExists(db, id)) return c.json({ error: 'Unknown game' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const note = z.object({ note: z.string().max(500).optional() }).catch({}).parse(body).note;
    const score = service.analyze().find((g) => g.metrics.gameId === id)?.score.score ?? null;
    addToWatchlist(db, id, score, note);
    return c.json({ ok: true });
  });

  app.delete('/api/watchlist/:id', (c) => {
    removeFromWatchlist(db, c.req.param('id').replace(/^0+/, ''));
    return c.json({ ok: true });
  });

  // Admin: manual refresh (rate limited; optional bearer token).
  app.post('/api/refresh', async (c) => {
    if (deps.adminToken && c.req.header('authorization') !== `Bearer ${deps.adminToken}`) return c.json({ error: 'Unauthorized' }, 401);
    const now = Date.now();
    if (inFlight) return c.json({ error: 'An update is already running.' }, 409);
    if (now - lastManualRefresh < cooldown) {
      return c.json({ error: `Please wait ${Math.ceil((cooldown - (now - lastManualRefresh)) / 1000)}s before refreshing again (NJ data is cached for 5 minutes).` }, 429);
    }
    lastManualRefresh = now;
    inFlight = refresh('manual');
    try {
      const r = await inFlight;
      service.invalidate();
      return c.json({ status: r.status, error: r.error ?? null, snapshots: r.snapshots ?? 0, events: r.events ?? 0 }, r.status === 'failed' ? 502 : 200);
    } finally {
      inFlight = null;
    }
  });

  return { app, service };
}
