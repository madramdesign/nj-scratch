import { describe, expect, it, vi } from 'vitest';
import { openDatabase, listRuns, listEvents, gameHistory, latestDataRun, loadRunGames, loadRawPayload, dbStats } from '@nj/database';
import { fetchGamesPayload, FetchError, ingestPayload, rebuildChangeEvents, runUpdate, captureTime } from '../src/index.ts';
import { DAY, fillerGames, payload, referenceGame, loadRealFixture, FIXTURE_NOW } from '../../../fixtures/testkit.ts';

const now = Date.parse('2026-06-01T00:00:00Z');
const body = (games: any[]) => JSON.stringify(payload(games));
const baseGames = () => [...fillerGames(25, now), referenceGame({ now })];

function jsonResponse(status: number, text: string, contentType = 'application/json') {
  return new Response(text, { status, headers: { 'content-type': contentType } });
}

describe('fetchGamesPayload', () => {
  const noSleep = async () => {};

  it('returns the body on success and identifies itself', async () => {
    const f = vi.fn(async (_url: any, init: any) => {
      expect(init.headers['User-Agent']).toMatch(/nj-scratch-tracker/);
      return jsonResponse(200, '{"games":[]}');
    });
    const r = await fetchGamesPayload({ fetchImpl: f as any, sleep: noSleep });
    expect(r.body).toBe('{"games":[]}');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const f = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(503, 'busy'))
      .mockResolvedValueOnce(jsonResponse(200, '{}'));
    const r = await fetchGamesPayload({ fetchImpl: f as any, sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 100 });
    expect(r.status).toBe(200);
    expect(sleeps).toEqual([100, 200]);
  });

  it('does not retry permanent client errors', async () => {
    const f = vi.fn(async () => jsonResponse(404, 'nope'));
    await expect(fetchGamesPayload({ fetchImpl: f as any, sleep: noSleep })).rejects.toBeInstanceOf(FetchError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget', async () => {
    const f = vi.fn(async () => jsonResponse(500, 'err'));
    await expect(fetchGamesPayload({ fetchImpl: f as any, sleep: noSleep, retries: 2 })).rejects.toThrow(/500/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('fails loudly if the endpoint starts returning HTML', async () => {
    const f = vi.fn(async () => jsonResponse(200, '<html>', 'text/html'));
    await expect(fetchGamesPayload({ fetchImpl: f as any, sleep: noSleep })).rejects.toThrow(/content-type/);
  });
});

describe('ingestPayload → database', () => {
  it('stores snapshots, scores and the raw payload', () => {
    const db = openDatabase(':memory:');
    const r = ingestPayload(db, { body: body(baseGames()), observedAt: now, source: 'official', trigger: 'test' });
    expect(r.status).toBe('success');
    expect(r.snapshots).toBe(26);
    const run = latestDataRun(db)!;
    expect(run.games_active).toBe(26);
    const stored = loadRunGames(db, run.id);
    const ref = stored.find((s) => s.game.gameId === '4242')!.game;
    expect(ref.tiers.find((t) => t.prizeCents === 1_000_000)!.remaining).toBe(8);
    expect(gameHistory(db, '4242')).toHaveLength(1);
    expect(loadRawPayload(db, run.payload_hash!)).toBe(body(baseGames()));
  });

  it('records identical data as "unchanged" without new snapshots', () => {
    const db = openDatabase(':memory:');
    ingestPayload(db, { body: body(baseGames()), observedAt: now, source: 'official', trigger: 'test' });
    const r = ingestPayload(db, { body: body(baseGames()), observedAt: now + 3600_000, source: 'official', trigger: 'test' });
    expect(r.status).toBe('unchanged');
    expect(dbStats(db).snapshots).toBe(26);
  });

  it('records malformed data as a FAILED run and writes nothing else', () => {
    const db = openDatabase(':memory:');
    ingestPayload(db, { body: body(baseGames()), observedAt: now, source: 'official', trigger: 'test' });
    const before = dbStats(db);
    const bad = ingestPayload(db, { body: '{"unexpected": true}', observedAt: now + DAY, source: 'official', trigger: 'test' });
    expect(bad.status).toBe('failed');
    expect(bad.error).toMatch(/expected schema/);
    const notJson = ingestPayload(db, { body: '<html>maintenance</html>', observedAt: now + DAY, source: 'official', trigger: 'test' });
    expect(notJson.status).toBe('failed');
    expect(dbStats(db).snapshots).toBe(before.snapshots);
    expect(listRuns(db)[0].status).toBe('failed');
    // The previous good data is still the current data.
    expect(latestDataRun(db)!.observed_at).toBe(now);
  });

  it('never overwrites history and detects changes between updates', () => {
    const db = openDatabase(':memory:');
    ingestPayload(db, { body: body(baseGames()), observedAt: now, source: 'official', trigger: 'test' });
    const next = baseGames();
    const ref = next.find((g) => g.gameId === '4242');
    ref.prizeTiers[3].claimedTickets += 2; // two $10,000 top prizes claimed
    ref.prizeTiers[1].paidTickets += 1000;
    const r = ingestPayload(db, { body: body(next), observedAt: now + DAY, source: 'official', trigger: 'test' });
    expect(r.status).toBe('success');
    const hist = gameHistory(db, '4242');
    expect(hist.map((h) => h.top_remaining)).toEqual([8, 6]);
    const events = listEvents(db, { gameId: '4242' });
    expect(events.some((e) => e.kind === 'top_prize_claimed' && /2 × \$10,000 top prizes claimed/.test(e.message))).toBe(true);
  });

  it('reports changed prize values as structure changes', () => {
    const db = openDatabase(':memory:');
    ingestPayload(db, { body: body(baseGames()), observedAt: now, source: 'official', trigger: 'test' });
    const next = baseGames();
    next.find((g) => g.gameId === '4242').prizeTiers[2].prizeAmount = 150_000;
    ingestPayload(db, { body: body(next), observedAt: now + DAY, source: 'official', trigger: 'test' });
    expect(listEvents(db, { gameId: '4242' }).some((e) => e.kind === 'structure_changed')).toBe(true);
  });

  it('flags new games after the first load', () => {
    const db = openDatabase(':memory:');
    ingestPayload(db, { body: body(baseGames()), observedAt: now, source: 'official', trigger: 'test' });
    const extra = referenceGame({ now, id: 7777, name: 'Brand New' });
    ingestPayload(db, { body: body([...baseGames(), extra]), observedAt: now + DAY, source: 'official', trigger: 'test' });
    expect(listEvents(db, { gameId: '7777' })[0].kind).toBe('game_added');
  });

  it('accepts out-of-order backfill and rebuilds events chronologically', () => {
    const db = openDatabase(':memory:');
    const later = baseGames();
    later.find((g) => g.gameId === '4242').prizeTiers[3].claimedTickets += 3;
    ingestPayload(db, { body: body(later), observedAt: now + 10 * DAY, source: 'official', trigger: 'test' });
    ingestPayload(db, { body: body(baseGames()), observedAt: now, source: 'archive', trigger: 'backfill', computeEvents: false });
    rebuildChangeEvents(db);
    expect(gameHistory(db, '4242').map((h) => h.top_remaining)).toEqual([8, 5]);
    expect(listEvents(db, { gameId: '4242' }).some((e) => e.kind === 'top_prize_claimed')).toBe(true);
    expect(latestDataRun(db)!.observed_at).toBe(now + 10 * DAY);
  });

  it('ingests the saved real response (regression)', () => {
    const db = openDatabase(':memory:');
    const r = ingestPayload(db, { body: JSON.stringify(loadRealFixture()), observedAt: FIXTURE_NOW, source: 'official', trigger: 'test' });
    expect(r.status).toBe('success');
    expect(r.report?.activeGames).toBe(65);
  });
});

describe('runUpdate', () => {
  it('records fetch failures as failed runs', async () => {
    const db = openDatabase(':memory:');
    const r = await runUpdate(db, { trigger: 'test', fetch: { fetchImpl: (async () => jsonResponse(403, 'blocked')) as any, sleep: async () => {} } });
    expect(r.status).toBe('failed');
    expect(listRuns(db)[0]).toMatchObject({ status: 'failed', http_status: 403 });
  });
});

describe('backfill helpers', () => {
  it('parses Internet Archive timestamps as UTC', () => {
    expect(captureTime('20250811014117')).toBe(Date.UTC(2025, 7, 11, 1, 41, 17));
  });
});

describe('verifyDatabase (backup safety check)', async () => {
  const { mkdtempSync, writeFileSync, copyFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { verifyDatabase } = await import('../src/verify-db.ts');

  function fileDb(dir: string, name: string, runs: number) {
    const path = join(dir, name);
    const db = openDatabase(path);
    for (let i = 0; i < runs; i++) {
      const games = baseGames();
      games[0].prizeTiers[0].paidTickets += i; // make each run a real data change
      ingestPayload(db, { body: body(games), observedAt: now + i * 3600_000, source: 'official', trigger: 'test' });
    }
    db.close();
    return path;
  }

  it('accepts a healthy copy that grew since the previous backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'njv-'));
    const prev = fileDb(dir, 'prev.db', 1);
    const next = fileDb(dir, 'next.db', 2);
    expect(verifyDatabase(next, prev)).toEqual([]);
    expect(verifyDatabase(next, join(dir, 'missing.db'))).toEqual([]);
  });

  it('rejects a copy that lost history rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'njv-'));
    const prev = fileDb(dir, 'prev.db', 2);
    const next = fileDb(dir, 'next.db', 1);
    expect(verifyDatabase(next, prev).join('\n')).toMatch(/update_runs shrank from 2 to 1/);
  });

  it('rejects a missing, empty or corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'njv-'));
    expect(verifyDatabase(join(dir, 'nope.db'))).toEqual([expect.stringMatching(/does not exist/)]);
    expect(verifyDatabase(fileDb(dir, 'empty.db', 0))).toContain('update_runs is empty');
    const bad = join(dir, 'bad.db');
    copyFileSync(fileDb(dir, 'good.db', 1), bad);
    writeFileSync(bad, Buffer.alloc(4096, 7), { flag: 'r+' });
    expect(verifyDatabase(bad).length).toBeGreaterThan(0);
  });
});

describe('out-of-date responses', async () => {
  const { quarantineStaleRuns, paidShortfall } = await import('../src/index.ts');
  const withPaid = (extra: number) => {
    const games = baseGames();
    games[0].prizeTiers[0].paidTickets += extra;
    return games;
  };

  it('ignores a response with fewer paid prizes than the stored data', () => {
    const db = openDatabase(':memory:');
    ingestPayload(db, { body: body(withPaid(0)), observedAt: now, source: 'official', trigger: 'test' });
    const newer = ingestPayload(db, { body: body(withPaid(10)), observedAt: now + 60_000, source: 'official', trigger: 'test' });
    expect(newer.status).toBe('success');
    const older = ingestPayload(db, { body: body(withPaid(4)), observedAt: now + 120_000, source: 'official', trigger: 'test' });
    expect(older.status).toBe('stale');
    expect(older.error).toMatch(/out-of-date copy of the data \(6 fewer paid prizes/);
    expect(latestDataRun(db)!.id).toBe(newer.runId);
    expect(listEvents(db, { runId: older.runId })).toHaveLength(0);
    // The same out-of-date response again is recognized and not re-processed.
    expect(ingestPayload(db, { body: body(withPaid(4)), observedAt: now + 180_000, source: 'official', trigger: 'test' }).status).toBe('unchanged');
    // Real progress afterwards is accepted.
    expect(ingestPayload(db, { body: body(withPaid(20)), observedAt: now + 240_000, source: 'official', trigger: 'test' }).status).toBe('success');
  });

  it('paidShortfall only compares games present in both', () => {
    const prev = new Map([['1', 100], ['gone', 999]]);
    const g = (id: string, paid: number) => ({ gameId: id, tiers: [{ paid }] }) as any;
    expect(paidShortfall(prev, [g('1', 90), g('new', 5)])).toBe(10);
    expect(paidShortfall(prev, [g('1', 120)])).toBe(-20);
  });

  it('withdraws earlier runs that went backwards and rebuilds events', () => {
    const db = openDatabase(':memory:');
    // Build a history stored before the check existed: a (0) → b (10) → c (4, an out-of-date copy).
    // Ingesting b last with an earlier observation time skips the live check, like the old code.
    const a = ingestPayload(db, { body: body(withPaid(0)), observedAt: now, source: 'official', trigger: 'test' });
    const c = ingestPayload(db, { body: body(withPaid(4)), observedAt: now + 120_000, source: 'official', trigger: 'test' });
    const b = ingestPayload(db, { body: body(withPaid(10)), observedAt: now + 60_000, source: 'official', trigger: 'test' });
    expect([a.status, b.status, c.status]).toEqual(['success', 'success', 'success']);

    expect(quarantineStaleRuns(db)).toEqual([c.runId]);
    expect(latestDataRun(db)!.id).toBe(b.runId);
    const run = listRuns(db, 10).find((r) => r.id === c.runId)!;
    expect(run.status).toBe('stale');
    expect(run.error).toMatch(/6 fewer paid prizes/);
    expect(listEvents(db, { runId: c.runId })).toHaveLength(0);
    expect(loadRawPayload(db, c.report!.payloadHash)).not.toBeNull(); // the raw response is kept as a record
    expect(listEvents(db, { runId: b.runId }).length).toBeGreaterThan(0);
    expect(quarantineStaleRuns(db)).toEqual([]); // idempotent
  });
});
