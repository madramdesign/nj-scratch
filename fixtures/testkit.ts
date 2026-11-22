/** Builders for synthetic NJ API payloads used across tests. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DAY = 86_400_000;
/** A fixed "now" for regression tests against the saved real response (captured 2026-11-22 UTC). */
export const FIXTURE_NOW = Date.parse('2026-11-22T05:00:00Z');

export function loadRealFixture(): any {
  return JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'nj-instant-games-2026-11-22.json'), 'utf8'));
}

export interface TierSpec {
  prize: number; // cents
  original: number;
  paid?: number;
  claimed?: number;
  type?: number;
  desc?: string;
}

let nextId = 5000;

export function rawGame(p: { id?: string | number; name?: string; price?: number; printed?: number | null; tiers: TierSpec[]; now?: number; status?: 'active' | 'ended' | 'expired' | 'upcoming' }): any {
  const now = p.now ?? Date.now();
  const launch = p.status === 'upcoming' ? now + 10 * DAY : now - 200 * DAY;
  const disable = p.status === 'ended' ? now + 100 * DAY : p.status === 'expired' ? now - 10 * DAY : now + 800 * DAY;
  return {
    gameId: String(p.id ?? nextId++),
    gameName: p.name ?? 'Test Game',
    validationStatus: 'ACTIVE',
    ticketPrice: p.price ?? 200,
    launchDate: launch,
    startDistributionDate: launch,
    endDistributionDate: disable,
    disableDate: disable,
    totalTicketsPrinted: p.printed === undefined ? 1_000_000 : p.printed,
    prizeTiers: p.tiers.map((t, i) => ({
      tierNumber: i + 1,
      prizeAmount: t.prize,
      winningTickets: t.original,
      paidTickets: t.paid ?? 0,
      claimedTickets: t.claimed ?? 0,
      prizeDescription: t.desc ?? (t.type === 2 ? 'FREE TICKET' : `$${(t.prize / 100).toLocaleString('en-US')}`),
      originalTierNumber: i + 1,
      tierType: t.type ?? 1,
    })),
  };
}

/**
 * The hand-checked reference game used by the analytics tests.
 * $2 ticket, 1,000,000 printed. Half of the retail tiers are paid => 500,000 tickets remain.
 *   original EV = (100k×$5 + 100×$1,000 + 10×$10,000) / 1M / (1 − 0.1) = $0.70 / 0.9 = 77.78¢
 *   current  EV = (50k×$5 + 80×$1,000 + 8×$10,000) / 500k / (1 − 0.1)   = $0.82 / 0.9 = 91.11¢
 */
export function referenceGame(overrides: Partial<Parameters<typeof rawGame>[0]> = {}) {
  return rawGame({
    id: 4242,
    name: 'Reference Game',
    price: 200,
    printed: 1_000_000,
    tiers: [
      { prize: 200, original: 100_000, paid: 50_000, type: 2, desc: 'FREE $2 TICKET' },
      { prize: 500, original: 100_000, paid: 50_000 },
      { prize: 100_000, original: 100, paid: 15, claimed: 20 },
      { prize: 1_000_000, original: 10, paid: 2, claimed: 2 },
    ],
    ...overrides,
  });
}

/** A filler population of plausible active games so payload-level validation passes. */
export function fillerGames(n: number, now: number): any[] {
  return Array.from({ length: n }, (_, i) =>
    rawGame({
      id: 9000 + i,
      name: `Filler ${i}`,
      price: [100, 200, 500, 1000, 2000, 3000][i % 6],
      now,
      tiers: [
        { prize: [100, 200, 500, 1000, 2000, 3000][i % 6], original: 200_000, paid: 60_000 + i * 2000, type: 2 },
        { prize: 1000, original: 150_000, paid: 45_000 + i * 1500 },
        { prize: 5_000_000, original: 4, claimed: i % 4, paid: i % 4 },
      ],
    }),
  );
}

export function payload(games: any[]) {
  return { nextPageUrl: null, previousPageUrl: null, pageUrls: null, nextItems: null, previousItems: null, games };
}
