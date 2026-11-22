import { describe, expect, it } from 'vitest';
import { normalizeGame, parseGamesResponse, RawGameSchema } from '@nj/lottery-data';
import { analyzeGames, computeGameMetrics, diffGame, estimateTickets, explainGame, percentiles, scoreChangeEvent, scoreGames, DEFAULT_WEIGHTS } from '../src/index.ts';
import { FIXTURE_NOW, loadRealFixture, rawGame, referenceGame } from '../../../fixtures/testkit.ts';

const now = Date.parse('2026-06-01T00:00:00Z');
const norm = (raw: any) => normalizeGame(RawGameSchema.parse(raw), now);

describe('computeGameMetrics — hand-checked reference game', () => {
  const m = computeGameMetrics(norm(referenceGame({ now })));

  it('estimates tickets remaining from retail-tier paid ratios', () => {
    expect(m.tickets.available).toBe(true);
    if (!m.tickets.available) return;
    expect(m.tickets.soldFraction).toBeCloseTo(0.5, 10);
    expect(m.tickets.ticketsRemaining).toBe(500_000);
    expect(m.tickets.confidence).toBe('normal');
  });

  it('computes original EV exactly, valuing free tickets as a replay', () => {
    // (100k×500¢ + 100×100,000¢ + 10×1,000,000¢) / 1M = 70¢; ÷ (1 − 0.1) = 77.78¢
    expect(m.originalEvCents).toBeCloseTo(70 / 0.9, 8);
    expect(m.originalReturn).toBeCloseTo(70 / 0.9 / 200, 8);
  });

  it('computes current EV from remaining prizes and estimated remaining tickets', () => {
    // (50k×500 + 80×100,000 + 8×1,000,000) / 500k = 82¢; ÷ 0.9 = 91.11¢
    expect(m.currentEvCents).toBeCloseTo(82 / 0.9, 8);
    expect(m.currentReturn).toBeCloseTo(82 / 0.9 / 200, 8);
    expect(m.expectedLossCents).toBeCloseTo(200 - 82 / 0.9, 8);
  });

  it('computes top/major/all-prize percentages and values', () => {
    expect(m.topPrize).toMatchObject({ original: 10, remaining: 8, pctRemaining: 0.8, label: '$10,000' });
    expect(m.major).toMatchObject({ original: 10, remaining: 8, tierCount: 1 }); // default threshold $10k
    expect(m.allPrizes.original).toBe(200_110);
    expect(m.allPrizes.remaining).toBe(100_088);
    expect(m.allPrizes.valueOriginalCents).toBe(100_000 * 200 + 100_000 * 500 + 100 * 100_000 + 10 * 1_000_000);
    expect(m.prizeToTicketRatio).toBe(m.allPrizes.valueRemainingCents / 200);
  });

  it('expresses availability relative to sales (retention)', () => {
    expect(m.topRetention).toBeCloseTo(1.6, 10); // 80% of top prizes ÷ 50% of tickets
    expect(m.majorRetention).toBeCloseTo(1.6, 10);
  });

  it('computes odds from official counts at launch and estimates now', () => {
    expect(m.originalOddsAnyOneIn).toBeCloseTo(1_000_000 / 200_110, 10);
    expect(m.currentOddsAnyOneIn).toBeCloseTo(500_000 / 100_088, 10);
    expect(m.originalOddsTopOneIn).toBe(100_000);
    expect(m.currentOddsTopOneIn).toBe(62_500);
    // profit = cash prizes above $2: $5, $1,000, $10,000
    expect(m.currentOddsProfitOneIn).toBeCloseTo(500_000 / (50_000 + 80 + 8), 10);
  });

  it('honours a configurable major-prize threshold', () => {
    const m2 = computeGameMetrics(norm(referenceGame({ now })), { majorThresholdCents: 100_000 });
    expect(m2.major).toMatchObject({ original: 110, remaining: 88, tierCount: 2 });
    expect(m2.majorBreakdown.map((b) => b.thresholdCents)).toEqual([1_000_000]);
  });
});

describe('estimateTickets — refuses to fabricate', () => {
  it('requires total tickets printed', () => {
    const e = estimateTickets(norm(referenceGame({ now, printed: null })));
    expect(e.available).toBe(false);
  });
  it('requires enough retail-tier prizes', () => {
    const e = estimateTickets(norm(rawGame({ now, tiers: [{ prize: 500, original: 5_000, paid: 2_000 }, { prize: 100_000, original: 10 }] })));
    expect(e).toMatchObject({ available: false });
  });
  it('refuses when nearly all tickets are sold', () => {
    const e = estimateTickets(norm(rawGame({ now, tiers: [{ prize: 500, original: 100_000, paid: 99_000 }] })));
    expect(e.available).toBe(false);
  });
  it('flags low confidence when retail tiers disagree', () => {
    const e = estimateTickets(norm(rawGame({ now, tiers: [{ prize: 500, original: 100_000, paid: 20_000 }, { prize: 1000, original: 100_000, paid: 60_000 }] })));
    expect(e).toMatchObject({ available: true, confidence: 'low' });
  });
  it('leaves EV and odds null instead of guessing', () => {
    const m = computeGameMetrics(norm(referenceGame({ now, printed: null })));
    expect(m.currentEvCents).toBeNull();
    expect(m.originalEvCents).toBeNull();
    expect(m.topRetention).toBeNull();
    expect(m.currentOddsAnyOneIn).toBeNull();
  });
});

describe('percentiles', () => {
  it('ranks values 0–100 and averages ties', () => {
    expect(percentiles([10, 20, 30])).toEqual([0, 50, 100]);
    expect(percentiles([1, 1, 3])).toEqual([25, 25, 100]);
    expect(percentiles([null, 5, 7])).toEqual([null, 0, 100]);
    expect(percentiles([4])).toEqual([50]);
  });
});

/**
 * The scenario from the product brief: a bigger jackpot with almost none left must NOT outrank
 * a smaller jackpot that is mostly still available.
 */
describe('scoring favours strong remaining-prize profiles over big jackpots', () => {
  const retail = (price: number, paidFrac: number) => [
    { prize: price, original: 400_000, paid: Math.round(400_000 * paidFrac), type: 2 },
    { prize: price * 2, original: 300_000, paid: Math.round(300_000 * paidFrac) },
    { prize: price * 5, original: 100_000, paid: Math.round(100_000 * paidFrac) },
  ];
  const gameA = rawGame({ id: 1, name: 'Game A', price: 3000, now, tiers: [...retail(3000, 0.5), { prize: 10_000_000, original: 60, claimed: 40 }, { prize: 500_000_000, original: 10, claimed: 9 }] });
  const gameB = rawGame({ id: 2, name: 'Game B', price: 2000, now, tiers: [...retail(2000, 0.5), { prize: 10_000_000, original: 60, claimed: 20 }, { prize: 200_000_000, original: 8, claimed: 3 }] });
  const fillers = [3, 4, 5, 6].map((i) => rawGame({ id: 10 + i, price: 1000, now, tiers: [...retail(1000, 0.5), { prize: 50_000_000, original: 4, claimed: 2 }] }));
  const analyzed = analyzeGames([gameA, gameB, ...fillers].map(norm));
  const a = analyzed.find((x) => x.metrics.name === 'Game A')!;
  const b = analyzed.find((x) => x.metrics.name === 'Game B')!;

  it('ranks Game B ($2M, 5 of 8 left) above Game A ($5M, 1 of 10 left)', () => {
    expect(b.score.score!).toBeGreaterThan(a.score.score!);
    expect(b.score.rank!).toBeLessThan(a.score.rank!);
    expect(a.metrics.topPrize.pctRemaining).toBeCloseTo(0.1);
    expect(b.metrics.topPrize.pctRemaining).toBeCloseTo(5 / 8);
  });

  it('explains both rankings with data', () => {
    expect(b.explanation.strengths.join(' ')).toMatch(/5 of 8 top prizes/);
    expect(a.explanation.weaknesses.join(' ')).toMatch(/1 of 10 top prizes/);
    expect(a.explanation.avoidReasons.length).toBeGreaterThan(0);
  });

  it('scores are 0–100 and components sum to the score', () => {
    for (const g of analyzed) {
      expect(g.score.score!).toBeGreaterThanOrEqual(0);
      expect(g.score.score!).toBeLessThanOrEqual(100);
      const sum = g.score.components.reduce((s, c) => s + c.contribution, 0);
      if (!g.score.capped) expect(sum).toBeCloseTo(g.score.score!, 0);
      const w = g.score.components.reduce((s, c) => s + c.effectiveWeight, 0);
      expect(w).toBeCloseTo(1, 10);
    }
  });
});

describe('scoreGames options', () => {
  const games = [
    rawGame({ id: 1, now, tiers: [{ prize: 200, original: 200_000, paid: 100_000, type: 2 }, { prize: 50_000, original: 1_000, paid: 400 }, { prize: 1_000_000, original: 4, claimed: 4 }] }),
    rawGame({ id: 2, now, tiers: [{ prize: 200, original: 200_000, paid: 100_000, type: 2 }, { prize: 50_000, original: 1_000, paid: 600 }, { prize: 1_000_000, original: 4, claimed: 0 }] }),
    rawGame({ id: 3, now, tiers: [{ prize: 200, original: 200_000, paid: 100_000, type: 2 }, { prize: 50_000, original: 1_000, paid: 500 }, { prize: 1_000_000, original: 4, claimed: 2 }] }),
  ].map((r) => computeGameMetrics(norm(r)));

  it('caps games with no top prize left', () => {
    const s = scoreGames(games, { weights: { expectedReturn: 100, topPrize: 0, majorPrize: 0, profitOdds: 0, prizeValue: 0 } });
    // Game 1 has the best EV-free mix? Regardless, any game with zero top prizes can't exceed 40.
    expect(s.get('1')!.score!).toBeLessThanOrEqual(40);
    expect(s.get('1')!.label).not.toBe('strong');
  });

  it('a single-component weighting reproduces that component ranking', () => {
    const s = scoreGames(games, { weights: { expectedReturn: 0, topPrize: 100, majorPrize: 0, profitOdds: 0, prizeValue: 0 }, noTopPrizeCap: null });
    expect(s.get('2')!.rank).toBe(1);
    expect(s.get('1')!.rank).toBe(3);
  });

  it('redistributes weight when a component is unavailable', () => {
    const small = computeGameMetrics(norm(rawGame({ id: 9, now, tiers: [{ prize: 200, original: 200_000, paid: 100_000, type: 2 }, { prize: 50_000, original: 1_000, paid: 500 }] })));
    const s = scoreGames([...games, small]).get('9')!;
    const major = s.components.find((c) => c.key === 'majorPrize')!;
    expect(major.percentile).toBeNull();
    expect(major.effectiveWeight).toBe(0);
    expect(s.notes.join(' ')).toMatch(/weight redistributed/);
  });

  it('uses documented default weights that sum to 100', () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('change detection', () => {
  it('reports top, major and small prize claims', () => {
    const prev = norm(referenceGame({ now }));
    const raw = referenceGame({ now });
    raw.prizeTiers[3].claimedTickets += 1; // $10,000 top
    raw.prizeTiers[2].claimedTickets += 2; // $1,000
    raw.prizeTiers[1].paidTickets += 500; // $5
    const events = diffGame(prev, norm(raw), 100_000);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['top_prize_claimed', 'major_prize_claimed', 'prizes_claimed']));
    expect(events.find((e) => e.kind === 'top_prize_claimed')!.message).toBe('1 × $10,000 top prize claimed (7 left).');
  });

  it('flags changed prize values or counts as structure changes', () => {
    const prev = norm(referenceGame({ now }));
    const raw = referenceGame({ now });
    raw.prizeTiers[1].winningTickets += 10;
    raw.prizeTiers[2].prizeAmount = 200_000;
    const events = diffGame(prev, norm(raw));
    expect(events.filter((e) => e.kind === 'structure_changed').length).toBeGreaterThanOrEqual(2);
  });

  it('flags remaining counts that go up (data revisions)', () => {
    const raw = referenceGame({ now });
    raw.prizeTiers[3].claimedTickets = 5;
    const events = diffGame(norm(raw), norm(referenceGame({ now })));
    expect(events.some((e) => e.kind === 'structure_changed' && /increased/.test(e.message))).toBe(true);
  });

  it('reports significant score changes only', () => {
    expect(scoreChangeEvent('1', 82, 76)?.message).toBe('Score decreased from 82 → 76.');
    expect(scoreChangeEvent('1', 82, 80)).toBeNull();
    expect(scoreChangeEvent('1', null, 80)).toBeNull();
  });
});

describe('regression: real data sanity', () => {
  const { games } = parseGamesResponse(loadRealFixture(), { now: FIXTURE_NOW });
  const analyzed = analyzeGames(games);

  it('ranks all 65 active games with unique ranks', () => {
    expect(analyzed).toHaveLength(65);
    const ranks = analyzed.map((a) => a.score.rank);
    expect(new Set(ranks).size).toBe(65);
  });

  it('produces launch returns consistent with NJ’s published ~63% prize payout', () => {
    for (const a of analyzed) {
      expect(a.metrics.originalReturn!).toBeGreaterThan(0.5);
      expect(a.metrics.originalReturn!).toBeLessThan(0.8);
    }
  });

  it('never presents a ticket as profitable on average without a warning', () => {
    for (const a of analyzed) {
      if ((a.metrics.currentReturn ?? 0) > 1) expect(a.metrics.warnings.join(' ')).toMatch(/exceeds the ticket price/);
    }
  });

  it('caps every game with no top prizes left below "strong"', () => {
    for (const a of analyzed.filter((x) => x.metrics.topPrize.remaining === 0)) expect(a.score.label).not.toBe('strong');
  });

  it('explanations never use prohibited language', () => {
    const text = analyzed.flatMap((a) => [a.explanation.headline, ...a.explanation.strengths, ...a.explanation.weaknesses]).join(' ').toLowerCase();
    for (const bad of ['will win', 'guaranteed', 'you should buy', 'sure thing']) expect(text).not.toContain(bad);
  });

  it('explainGame works for an unrated game', () => {
    const m = analyzed[0].metrics;
    expect(explainGame(m, undefined, []).headline).toBe('Not enough data to rate');
  });
});
