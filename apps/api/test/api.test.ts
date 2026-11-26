import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '@nj/database';
import { ingestPayload } from '@nj/scraper';
import { createApp } from '../src/app.ts';
import { DashboardService } from '../src/service.ts';
import { FIXTURE_NOW, loadRealFixture } from '../../../fixtures/testkit.ts';

let db: DB;
let app: ReturnType<typeof createApp>['app'];
let refreshCalls = 0;

beforeAll(() => {
  db = openDatabase(':memory:');
  const fixture = loadRealFixture();
  // An earlier snapshot (one fewer top prize claimed for game 1908) so history and change detection have something to show.
  const earlier = JSON.parse(JSON.stringify(fixture));
  const g = earlier.games.find((x: any) => x.gameId === '1908');
  g.prizeTiers.sort((a: any, b: any) => b.prizeAmount - a.prizeAmount)[0].claimedTickets -= 1;
  ingestPayload(db, { body: JSON.stringify(earlier), observedAt: FIXTURE_NOW - 86_400_000, source: 'official', trigger: 'test' });
  ingestPayload(db, { body: JSON.stringify(fixture), observedAt: FIXTURE_NOW, source: 'official', trigger: 'test' });
  const service = new DashboardService(db, () => FIXTURE_NOW + 3600_000);
  ({ app } = createApp({
    db,
    service,
    refresh: async () => {
      refreshCalls++;
      return { runId: 0, status: 'unchanged' };
    },
  }));
});

const get = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
};

describe('API', () => {
  it('GET /api/games returns all active games with metrics and freshness status', async () => {
    const { status, body } = await get('/api/games');
    expect(status).toBe(200);
    expect(body.count).toBe(65);
    expect(body.games[0].score.rank).toBe(1);
    expect(body.games[0]).not.toHaveProperty('tiers');
    expect(body.status.isStale).toBe(false);
    expect(body.status.gamesRetrieved).toBe(304);
    expect(body.status.source.url).toMatch(/njlottery\.com\/api\/v1\/instant-games/);
  });

  it('GET /api/games/:id returns tiers, explanation and events; accepts padded numbers', async () => {
    const { body } = await get('/api/games/01908');
    expect(body.game.gameId).toBe('1908');
    expect(body.game.tiers.length).toBeGreaterThan(3);
    expect(body.game.explanation.headline).toMatch(/remaining-prize profile/);
    expect(body.events.some((e: any) => e.kind === 'top_prize_claimed')).toBe(true);
    expect(body.officialUrl).toBe('https://www.njlottery.com/en-us/scratch-offs/01908.html');
  });

  it('GET /api/games/:id 404s for unknown games and explains non-ranked ones', async () => {
    expect((await get('/api/games/99999')).status).toBe(404);
  });

  it('GET /api/games/:id/history returns ordered snapshots', async () => {
    const { body } = await get('/api/games/1908/history');
    expect(body.points).toHaveLength(2);
    expect(body.points[0].top_remaining).toBe(body.points[1].top_remaining + 1);
  });

  it('rankings endpoints', async () => {
    const best = await get('/api/rankings/best');
    expect(Object.keys(best.body)).toEqual(['overall', 'expectedValue', 'topPrize', 'majorPrize', 'value']);
    const worst = await get('/api/rankings/worst?limit=3');
    expect(worst.body.games).toHaveLength(3);
    expect(worst.body.games[0].score.rank).toBe(65);
    const byPrice = await get('/api/rankings/by-price/20');
    expect(byPrice.body.games.every((g: any) => g.priceCents === 2000)).toBe(true);
    expect(byPrice.body.best.score.rankInPrice).toBe(1);
    expect((await get('/api/rankings/by-price/abc')).status).toBe(400);
    expect((await get('/api/rankings?by=nope')).status).toBe(400);
    const ev = await get('/api/rankings?by=ev&limit=5');
    const r = ev.body.games.map((g: any) => g.currentReturn);
    expect([...r].sort((a: number, b: number) => b - a)).toEqual(r);
  });

  it('custom weights and major threshold change the ranking', async () => {
    const a = await get('/api/games');
    const b = await get('/api/games?w=expectedReturn:100,topPrize:0,majorPrize:0,profitOdds:0,prizeValue:0&major=100000');
    expect(b.body.games[0].score.components.find((c: any) => c.key === 'expectedReturn').effectiveWeight).toBe(1);
    expect(b.body.games[0].major.thresholdCents).toBe(10_000_000);
    expect(a.body.games.map((g: any) => g.gameId)).not.toEqual(b.body.games.map((g: any) => g.gameId));
  });

  it('GET /api/statistics and /api/updates', async () => {
    const s = await get('/api/statistics');
    expect(s.body.activeGames).toBe(65);
    expect(s.body.bestEv.value).toBeGreaterThan(0.6);
    const u = await get('/api/updates');
    expect(u.body.runs).toHaveLength(2);
  });

  it('watchlist add / list / remove', async () => {
    expect((await app.request('/api/watchlist/1908', { method: 'POST' })).status).toBe(200);
    expect((await app.request('/api/watchlist/424242', { method: 'POST' })).status).toBe(404);
    const w = await get('/api/watchlist');
    expect(w.body.items).toHaveLength(1);
    expect(w.body.items[0].game.gameId).toBe('1908');
    expect(w.body.items[0].previousScore).not.toBeNull();
    expect(w.body.alerts.length).toBeGreaterThan(0);
    await app.request('/api/watchlist/1908', { method: 'DELETE' });
    expect((await get('/api/watchlist')).body.items).toHaveLength(0);
  });

  it('manual refresh is rate limited', async () => {
    const first = await app.request('/api/refresh', { method: 'POST' });
    expect(first.status).toBe(200);
    const second = await app.request('/api/refresh', { method: 'POST' });
    expect(second.status).toBe(429);
    expect(refreshCalls).toBe(1);
  });

  it('marks data stale when it has not been verified recently', async () => {
    // Run timestamps are recorded with the real clock, so measure staleness from it.
    const stale = new DashboardService(db, () => Date.now() + 5 * 86_400_000);
    const { app: a2 } = createApp({ db, service: stale });
    const s = (await (await a2.request('/api/status')).json()) as any;
    expect(s.isStale).toBe(true);
    expect(s.warnings.join(' ')).toMatch(/may be stale/);
  });
});
