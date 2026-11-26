import { describe, expect, it } from 'vitest';
import { finishRun, openDatabase, startRun, type DB } from '@nj/database';
import { checkHealth, healthMarkdown } from '../src/health.ts';
import { ingestPayload } from '../src/ingest.ts';
import { fillerGames, payload, referenceGame } from '../../../fixtures/testkit.ts';

const H = 3_600_000;
const now = Date.parse('2026-06-10T12:00:00Z');

function run(db: DB, hoursAgo: number, status: 'success' | 'unchanged' | 'stale' | 'failed', error?: string) {
  const at = now - hoursAgo * H;
  const id = startRun(db, { source: 'official', trigger: 'test', observedAt: at, startedAt: at });
  finishRun(db, id, { status, error: error ?? null });
}

describe('checkHealth', () => {
  it('is healthy after a recent successful check', () => {
    const db = openDatabase(':memory:');
    run(db, 30, 'success');
    run(db, 4, 'unchanged');
    const r = checkHealth(db, now);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.lastSuccessfulCheckAt).toBe(now - 4 * H);
  });

  it('flags data that has not been verified for too long', () => {
    const db = openDatabase(':memory:');
    run(db, 40, 'success');
    const r = checkHealth(db, now);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/40 hours ago/);
  });

  it('flags several failed updates in a row, but not one', () => {
    const db = openDatabase(':memory:');
    run(db, 20, 'success');
    run(db, 12, 'failed', 'HTTP 503');
    expect(checkHealth(db, now).ok).toBe(true);
    run(db, 6, 'failed', 'HTTP 503');
    run(db, 1, 'failed', 'Schema mismatch\ndetails');
    const r = checkHealth(db, now);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/last 3 updates failed. Latest error: Schema mismatch$/);
    expect(healthMarkdown(r)).toMatch(/needs attention/);
  });

  it('flags an empty database and repeated out-of-date responses', () => {
    const db = openDatabase(':memory:');
    expect(checkHealth(db, now).problems).toEqual(['No update of njlottery.com has been attempted yet.']);
    run(db, 5, 'success');
    for (const h of [4, 3, 2, 1]) run(db, h, 'stale');
    expect(checkHealth(db, now).problems.join(' ')).toMatch(/4 out-of-date responses/);
  });

  it('flags a prize-structure revision in the newest data only', () => {
    const db = openDatabase(':memory:');
    const games = (tweak: boolean) => {
      const ref = referenceGame({ now });
      if (tweak) ref.prizeTiers[3].winningTickets = 12;
      return JSON.stringify(payload([...fillerGames(25, now), ref]));
    };
    ingestPayload(db, { body: games(false), observedAt: now - 2 * H, source: 'official', trigger: 'test' });
    ingestPayload(db, { body: games(true), observedAt: now - H, source: 'official', trigger: 'test' });
    // Run rows use the real clock for started_at, so check relative to it.
    const r = checkHealth(db, Date.now());
    expect(r.problems.join(' ')).toMatch(/revised official prize data in the latest update \(2 change/);
  });
});
