import { describe, expect, it } from 'vitest';
import { pNoneHypergeometric, sessionOdds, type SessionInput } from '../src/session.ts';

// The reference game after half of the run is sold: 500,000 tickets left, $2 ticket.
const game: SessionInput = {
  priceCents: 200,
  ticketsRemaining: 500_000,
  evCents: 91.11,
  tiers: [
    { prizeCents: 200, remaining: 50_000, kind: 'free_ticket' },
    { prizeCents: 500, remaining: 50_000, kind: 'cash' },
    { prizeCents: 100_000, remaining: 80, kind: 'cash' },
    { prizeCents: 1_000_000, remaining: 8, kind: 'cash' },
  ],
};

describe('sessionOdds', () => {
  it('matches the hypergeometric formula on a tiny pool', () => {
    // 2 winners among 5 tickets, draw 2: P(none) = C(3,2)/C(5,2) = 3/10.
    expect(pNoneHypergeometric(2, 5, 2)).toBeCloseTo(0.3, 12);
    expect(pNoneHypergeometric(0, 5, 2)).toBe(1);
    expect(pNoneHypergeometric(4, 5, 2)).toBe(0);
  });

  it('for one ticket, equals the per-ticket odds', () => {
    const r = sessionOdds(game, 1)!;
    expect(r.pAnyPrize).toBeCloseTo(100_088 / 500_000, 12);
    expect(r.pAnyProfitPrize).toBeCloseTo(50_088 / 500_000, 12);
    expect(r.pNetProfit).toBeCloseTo(50_088 / 500_000, 10);
    // A free ticket gets the price back, so it counts as breaking even.
    expect(r.pBreakEvenOrBetter).toBeCloseTo(100_088 / 500_000, 10);
    expect(r.expectedLossCents).toBeCloseTo(108.89, 6);
    expect(r.thresholds.map((t) => t.label)).toEqual(['$100 or more', '$1,000 or more', '$10,000 or more']);
    expect(r.thresholds[0].probability).toBeCloseTo(88 / 500_000, 12);
  });

  it('for two tickets, matches enumeration of every pair of outcomes', () => {
    const outcomes = [
      { v: 2, p: 0.1 },
      { v: 5, p: 0.1 },
      { v: 1000, p: 80 / 500_000 },
      { v: 10000, p: 8 / 500_000 },
    ];
    outcomes.push({ v: 0, p: 1 - outcomes.reduce((s, o) => s + o.p, 0) });
    let profit = 0;
    let even = 0;
    for (const a of outcomes) for (const b of outcomes) {
      if (a.v + b.v > 4) profit += a.p * b.p;
      if (a.v + b.v >= 4) even += a.p * b.p;
    }
    const r = sessionOdds(game, 2)!;
    expect(r.pNetProfit).toBeCloseTo(profit, 6);
    expect(r.pBreakEvenOrBetter).toBeCloseTo(even, 6);
    expect(r.costCents).toBe(400);
  });

  it('more tickets raise the chance of any prize but the expected loss grows with them', () => {
    const one = sessionOdds(game, 1)!;
    const ten = sessionOdds(game, 10)!;
    expect(ten.pAnyPrize).toBeGreaterThan(one.pAnyPrize);
    expect(ten.expectedLossCents!).toBeCloseTo(10 * one.expectedLossCents!, 6);
    expect(ten.pAllLose).toBeCloseTo(1 - ten.pAnyPrize, 12);
  });

  it('refuses impossible inputs', () => {
    expect(sessionOdds(game, 0)).toBeNull();
    expect(sessionOdds(game, 51)).toBeNull();
    expect(sessionOdds({ ...game, ticketsRemaining: 0 }, 1)).toBeNull();
  });

  it('drops thresholds no remaining prize can reach', () => {
    const r = sessionOdds({ ...game, tiers: game.tiers.slice(0, 2) }, 3)!;
    expect(r.thresholds).toEqual([]);
  });
});

import { samePriceAlternatives, type AlternativeCandidate } from '../src/alternatives.ts';

describe('samePriceAlternatives', () => {
  const g = (id: string, score: number | null, ret: number | null, top = 3, price = 1000, retention: number | null = 1): AlternativeCandidate => ({
    gameId: id, gameNumber: id.padStart(5, '0'), name: `G${id}`, priceCents: price, currentReturn: ret, topRetention: retention,
    topPrize: { remaining: top, original: 5, label: '$100,000' }, score: { score },
  });

  it('suggests same-price games that beat it on score and return, best first', () => {
    const target = g('1', 40, 0.6, 0, 1000, 0);
    const games = [target, g('2', 70, 0.68, 2, 1000, 1.4), g('3', 80, 0.65), g('4', 90, 0.7, 2, 2000), g('5', 85, 0.55), g('6', 60, 0.7, 0)];
    const alts = samePriceAlternatives(target, games);
    expect(alts.map((a) => a.game.gameId)).toEqual(['3', '2']);
    expect(alts[1].reasons).toEqual(['higher estimated return (68% vs 60%)', 'top-prize odds 1.4× launch vs 0.0×', '2 of 5 top prizes ($100,000) left, vs none']);
  });

  it('suggests nothing for the best game, unrated games, or small gaps', () => {
    expect(samePriceAlternatives(g('1', 90, 0.7), [g('1', 90, 0.7), g('2', 80, 0.65)])).toEqual([]);
    expect(samePriceAlternatives(g('1', null, 0.7), [g('2', 80, 0.75)])).toEqual([]);
    expect(samePriceAlternatives(g('1', 78, 0.6), [g('2', 80, 0.75)])).toEqual([]);
  });
});
