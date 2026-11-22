import { describe, expect, it } from 'vitest';
import { classifyStatus, DataValidationError, normalizeGame, parseAdvertisedAmount, parseGamesResponse, RawGameSchema } from '../src/index.ts';
import { DAY, FIXTURE_NOW, fillerGames, loadRealFixture, payload, rawGame, referenceGame } from '../../../fixtures/testkit.ts';

const now = Date.parse('2026-06-01T00:00:00Z');

describe('normalizeGame', () => {
  it('computes remaining prizes with the official NJ formula ($600+ uses claimed, smaller uses paid)', () => {
    const g = normalizeGame(RawGameSchema.parse(referenceGame({ now })), now);
    const byPrize = Object.fromEntries(g.tiers.map((t) => [t.prizeCents, t]));
    expect(byPrize[500].remaining).toBe(50_000); // 100k − 50k paid
    expect(byPrize[500].remainingBasis).toBe('paid');
    expect(byPrize[100_000].remaining).toBe(80); // 100 − 20 claimed (paid = 15 is ignored)
    expect(byPrize[100_000].remainingBasis).toBe('claimed');
    expect(byPrize[1_000_000].remaining).toBe(8);
  });

  it('treats exactly $600 as a claim-center prize', () => {
    const g = normalizeGame(RawGameSchema.parse(rawGame({ now, tiers: [{ prize: 60_000, original: 10, paid: 9, claimed: 3 }] })), now);
    expect(g.tiers[0].remaining).toBe(7);
  });

  it('sorts tiers by prize value, highest first, and pads the game number', () => {
    const g = normalizeGame(RawGameSchema.parse(referenceGame({ now })), now);
    expect(g.tiers.map((t) => t.prizeCents)).toEqual([1_000_000, 100_000, 500, 200]);
    expect(g.gameNumber).toBe('04242');
  });

  it('clamps negative remaining counts to zero and records a warning', () => {
    const g = normalizeGame(RawGameSchema.parse(rawGame({ now, tiers: [{ prize: 500, original: 10, paid: 12 }] })), now);
    expect(g.tiers[0].remaining).toBe(0);
    expect(g.issues.some((i) => i.code === 'NEGATIVE_REMAINING')).toBe(true);
  });

  it('flags unknown tier types as blocking errors', () => {
    const g = normalizeGame(RawGameSchema.parse(rawGame({ now, tiers: [{ prize: 500, original: 10, type: 99 }] })), now);
    expect(g.issues.find((i) => i.code === 'UNKNOWN_TIER_TYPE')?.severity).toBe('error');
  });

  it('flags missing prize tiers and missing tickets printed', () => {
    const raw = RawGameSchema.parse({ ...rawGame({ now, tiers: [] }), prizeTiers: null, totalTicketsPrinted: null });
    const g = normalizeGame(raw, now);
    expect(g.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['NO_PRIZE_TIERS', 'NO_TICKETS_PRINTED']));
  });

  it('flags games whose winners exceed tickets printed', () => {
    const g = normalizeGame(RawGameSchema.parse(rawGame({ now, printed: 100, tiers: [{ prize: 500, original: 200 }] })), now);
    expect(g.issues.some((i) => i.code === 'WINNERS_EXCEED_PRINTED')).toBe(true);
  });

  it('keeps the annuity cash value for math and parses the advertised amount', () => {
    const g = normalizeGame(RawGameSchema.parse(rawGame({ now, tiers: [{ prize: 60_230_000, original: 3, type: 16, desc: '$1,000,000*' }] })), now);
    expect(g.tiers[0].prizeCents).toBe(60_230_000);
    expect(g.tiers[0].advertisedCents).toBe(100_000_000);
    expect(g.tiers[0].kind).toBe('annuity');
  });

  it('changes its data hash when any number changes', () => {
    const a = normalizeGame(RawGameSchema.parse(referenceGame({ now })), now);
    const raw = referenceGame({ now });
    raw.prizeTiers[1].paidTickets += 1;
    const b = normalizeGame(RawGameSchema.parse(raw), now);
    expect(a.dataHash).not.toBe(b.dataHash);
  });
});

describe('parseAdvertisedAmount', () => {
  it.each([
    ['$1,000,000*', 100_000_000],
    ['$500', 50_000],
    ['$2,000,000', 200_000_000],
    ['$10,000 A MONTH/LIF', null],
    [null, null],
  ])('%s → %s', (input, out) => expect(parseAdvertisedAmount(input as string | null)).toBe(out));
});

describe('classifyStatus (same windows as njlottery.com)', () => {
  it('classifies active, ended, expired and upcoming games', () => {
    expect(classifyStatus({ launchDate: now - DAY, disableDate: now + 400 * DAY }, now)).toBe('active');
    expect(classifyStatus({ launchDate: now - DAY, disableDate: now + 100 * DAY }, now)).toBe('ended');
    expect(classifyStatus({ launchDate: now - 900 * DAY, disableDate: now - DAY }, now)).toBe('expired');
    expect(classifyStatus({ launchDate: now + DAY, disableDate: now + 900 * DAY }, now)).toBe('upcoming');
    expect(classifyStatus({ launchDate: null, disableDate: null }, now)).toBe('unknown');
  });
});

describe('parseGamesResponse', () => {
  const base = () => [...fillerGames(25, now), referenceGame({ now })];

  it('parses a valid payload and reports counts', () => {
    const { games, report } = parseGamesResponse(payload(base()), { now });
    expect(games).toHaveLength(26);
    expect(report.activeGames).toBe(26);
    expect(report.invalidActiveGames).toBe(0);
    expect(report.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails loudly when the response structure changes', () => {
    expect(() => parseGamesResponse({ items: [] }, { now })).toThrow(DataValidationError);
    const broken = base();
    broken[0].prizeTiers[0].winningTickets = 'lots';
    expect(() => parseGamesResponse(payload(broken), { now })).toThrow(/did not match the expected schema/);
  });

  it('rejects malformed values such as negative counts or zero price', () => {
    const neg = base();
    neg[1].prizeTiers[0].paidTickets = -5;
    expect(() => parseGamesResponse(payload(neg), { now })).toThrow(DataValidationError);
    const zero = base();
    zero[2].ticketPrice = 0;
    expect(() => parseGamesResponse(payload(zero), { now })).toThrow(DataValidationError);
  });

  it('refuses truncated or paginated responses', () => {
    expect(() => parseGamesResponse(payload(base().slice(0, 5)), { now })).toThrow(/Only 5 games/);
    expect(() => parseGamesResponse({ ...payload(base()), nextPageUrl: '/page/2' }, { now })).toThrow(/paginated/);
  });

  it('refuses when too few games are active', () => {
    const games = base().map((g) => ({ ...g, disableDate: now - DAY }));
    expect(() => parseGamesResponse(payload(games), { now })).toThrow(/active games found/);
  });

  it('collapses identical duplicate games but rejects conflicting duplicates', () => {
    const games = base();
    const dup = JSON.parse(JSON.stringify(games[3]));
    const ok = parseGamesResponse(payload([...games, dup]), { now });
    expect(ok.games).toHaveLength(26);
    expect(ok.report.duplicateGameIds).toEqual([dup.gameId]);
    dup.prizeTiers[0].paidTickets += 1;
    expect(() => parseGamesResponse(payload([...games, dup]), { now })).toThrow(/Conflicting duplicate/);
  });

  it('excludes a few invalid active games but fails if many are invalid', () => {
    const games = base();
    games[0].prizeTiers[0].tierType = 99;
    const r = parseGamesResponse(payload(games), { now });
    expect(r.report.invalidActiveGames).toBe(1);
    expect(r.report.rankableActiveGames).toBe(25);
    const many = base().map((g) => ({ ...g, prizeTiers: g.prizeTiers.map((t: any) => ({ ...t, tierType: 77 })) }));
    expect(() => parseGamesResponse(payload(many), { now })).toThrow(/failed validation/);
  });
});

describe('regression: saved real NJ Lottery response (2026-11-22)', () => {
  const { games, report } = parseGamesResponse(loadRealFixture(), { now: FIXTURE_NOW });

  it('discovers every game and the same active set as njlottery.com', () => {
    expect(report.totalGames).toBe(304);
    expect(report.activeGames).toBe(65);
    expect(report.invalidActiveGames).toBe(0);
    expect(report.duplicateGameIds).toEqual([]);
  });

  it('parses game 1851 "It Takes 2" exactly', () => {
    const g = games.find((x) => x.gameId === '1851')!;
    expect(g.name).toBe('It Takes 2');
    expect(g.priceCents).toBe(200);
    expect(g.totalTicketsPrinted).toBe(7_403_550);
    expect(g.status).toBe('active');
    const top = g.tiers[0];
    expect(top.description).toBe('$10,000');
    expect(top.original).toBe(6);
    expect(top.remaining).toBe(3);
    const four = g.tiers.find((t) => t.prizeCents === 400)!;
    expect(four.remaining).toBe(296_244 - 209_499);
  });

  it('keeps annuity top prizes at cash value', () => {
    const g = games.find((x) => x.gameId === '1908')!;
    expect(g.tiers[0].kind).toBe('annuity');
    expect(g.tiers[0].advertisedCents).toBe(500_000_000);
    expect(g.tiers[0].prizeCents).toBeLessThan(g.tiers[0].advertisedCents!);
  });

  it('every active game has prize tiers and tickets printed', () => {
    for (const g of games.filter((x) => x.status === 'active')) {
      expect(g.tiers.length).toBeGreaterThan(0);
      expect(g.totalTicketsPrinted).toBeGreaterThan(0);
      for (const t of g.tiers) expect(t.remaining).toBeLessThanOrEqual(t.original);
    }
  });
});
