import type { NormalizedGame, NormalizedTier } from '@nj/lottery-data/types';

/**
 * Per-game analytics. Everything here is derived ONLY from official NJ Lottery fields.
 * Values marked `estimated` depend on the tickets-remaining estimate and must be labeled as such in UI.
 * Money is in cents throughout.
 */

export const MAJOR_THRESHOLDS_CENTS = [1_000_000, 2_500_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000] as const;
export const DEFAULT_MAJOR_THRESHOLD_CENTS = 1_000_000; // $10,000

/** Prizes below this are paid by retailers; their paid ratios track sales closely. */
const RETAIL_TIER_MAX_CENTS = 60_000;
/** Minimum number of low-tier winners needed for a statistically meaningful sell-through estimate. */
const MIN_LOW_TIER_WINNERS = 10_000;
/** Above this sold fraction, the remaining-ticket estimate becomes dominated by noise/unclaimed prizes. */
const MAX_RELIABLE_SOLD_FRACTION = 0.97;
/** If individual low tiers disagree by more than this, flag the estimate as low confidence. */
const MAX_TIER_SPREAD = 0.12;

export interface TierAnalysis extends NormalizedTier {
  headlineCents: number;
  claimedCount: number;
  pctRemaining: number | null;
  valueRemainingCents: number;
  valueOriginalCents: number;
  isTop: boolean;
  isMajor: boolean;
  /** Current estimated odds of this prize per remaining ticket ("1 in X"). */
  currentOddsOneIn: number | null;
  originalOddsOneIn: number | null;
}

export interface PrizeGroupStats {
  original: number;
  remaining: number;
  pctRemaining: number | null;
  valueOriginalCents: number;
  valueRemainingCents: number;
}

export interface MajorBreakdown extends PrizeGroupStats {
  thresholdCents: number;
}

export type TicketEstimate =
  | {
      available: true;
      soldFraction: number;
      remainingFraction: number;
      ticketsRemaining: number;
      confidence: 'normal' | 'low';
      basisTiers: number;
      spread: number;
      note: string;
    }
  | { available: false; reason: string };

export interface GameMetrics {
  gameId: string;
  gameNumber: string;
  name: string;
  priceCents: number;
  status: NormalizedGame['status'];
  launchDate: number | null;
  totalTicketsPrinted: number | null;

  topPrize: {
    label: string;
    headlineCents: number;
    cashCents: number;
    kind: NormalizedTier['kind'];
  } & PrizeGroupStats;

  allPrizes: PrizeGroupStats;
  major: PrizeGroupStats & { thresholdCents: number; tierCount: number };
  majorBreakdown: MajorBreakdown[];

  tickets: TicketEstimate;

  /** Exact (from official printed counts): expected value of a ticket at launch. */
  originalEvCents: number | null;
  originalReturn: number | null;
  /** Estimated: expected value of a ticket bought now. */
  currentEvCents: number | null;
  currentReturn: number | null;
  expectedLossCents: number | null;

  originalOddsAnyOneIn: number | null;
  currentOddsAnyOneIn: number | null;
  /** Odds of winning MORE than the ticket price (a prize that is actually a profit). */
  currentOddsProfitOneIn: number | null;
  originalOddsProfitOneIn: number | null;
  currentOddsTopOneIn: number | null;
  originalOddsTopOneIn: number | null;
  currentOddsMajorOneIn: number | null;

  /** (% of X remaining) / (% of tickets remaining). 1.0 = on pace; >1 = X is over-represented in unsold stock. */
  topRetention: number | null;
  majorRetention: number | null;
  valueRetention: number | null;

  /** remaining prize value / ticket price */
  prizeToTicketRatio: number;

  tiers: TierAnalysis[];
  warnings: string[];
}

const headline = (t: NormalizedTier) => t.advertisedCents ?? t.prizeCents;

function group(tiers: NormalizedTier[]): PrizeGroupStats {
  let original = 0, remaining = 0, valueOriginalCents = 0, valueRemainingCents = 0;
  for (const t of tiers) {
    original += t.original;
    remaining += t.remaining;
    valueOriginalCents += t.original * t.prizeCents;
    valueRemainingCents += t.remaining * t.prizeCents;
  }
  return { original, remaining, pctRemaining: original > 0 ? remaining / original : null, valueOriginalCents, valueRemainingCents };
}

/**
 * Estimate the fraction of printed tickets already sold from the paid ratio of retailer-paid tiers.
 * Low tiers have hundreds of thousands of winners spread uniformly through the print run, so the share
 * that has been paid is a good proxy for the share of tickets sold and scratched.
 * Bias: unredeemed small prizes make this UNDER-estimate sales (=> conservative EV).
 */
export function estimateTickets(game: NormalizedGame): TicketEstimate {
  const printed = game.totalTicketsPrinted;
  if (!printed) return { available: false, reason: 'Total tickets printed is not published for this game.' };
  const low = game.tiers.filter((t) => t.prizeCents < RETAIL_TIER_MAX_CENTS && t.remainingBasis === 'paid' && t.original >= 1000);
  const lowWinners = low.reduce((s, t) => s + t.original, 0);
  if (lowWinners < MIN_LOW_TIER_WINNERS) {
    return { available: false, reason: `Too few low-tier prizes (${lowWinners.toLocaleString('en-US')}) to estimate sales reliably.` };
  }
  const lowPaid = low.reduce((s, t) => s + Math.min(t.paid, t.original), 0);
  const soldFraction = lowPaid / lowWinners;
  if (soldFraction >= MAX_RELIABLE_SOLD_FRACTION) {
    return { available: false, reason: `About ${(soldFraction * 100).toFixed(1)}% of low-tier prizes are paid; too few tickets remain to estimate reliably.` };
  }
  const big = low.filter((t) => t.original >= 10_000);
  const ratios = (big.length >= 2 ? big : low).map((t) => Math.min(t.paid, t.original) / t.original);
  const spread = Math.max(...ratios) - Math.min(...ratios);
  const confidence = spread > MAX_TIER_SPREAD ? 'low' : 'normal';
  const remainingFraction = 1 - soldFraction;
  return {
    available: true,
    soldFraction,
    remainingFraction,
    ticketsRemaining: Math.round(printed * remainingFraction),
    confidence,
    basisTiers: low.length,
    spread,
    note:
      `Based on ${low.length} retailer-paid prize tiers (${lowWinners.toLocaleString('en-US')} prizes): ${(soldFraction * 100).toFixed(1)}% paid.` +
      (confidence === 'low' ? ` Tiers disagree by ${(spread * 100).toFixed(0)} points, so treat this as low confidence.` : ''),
  };
}

/**
 * Expected value with free-ticket prizes valued as another play of the same game:
 *   EV = cashEV + pFree * EV  =>  EV = cashEV / (1 - pFree)
 */
function evFrom(tiers: NormalizedTier[], countOf: (t: NormalizedTier) => number, tickets: number): number | null {
  if (!(tickets > 0)) return null;
  let cash = 0, free = 0;
  for (const t of tiers) {
    const n = countOf(t);
    if (t.kind === 'free_ticket') free += n;
    else cash += n * t.prizeCents;
  }
  const pFree = free / tickets;
  if (pFree >= 1) return null;
  return cash / tickets / (1 - pFree);
}

const oneIn = (tickets: number | null, prizes: number) => (tickets && prizes > 0 ? tickets / prizes : null);

export function computeGameMetrics(game: NormalizedGame, opts: { majorThresholdCents?: number } = {}): GameMetrics {
  const majorThresholdCents = opts.majorThresholdCents ?? DEFAULT_MAJOR_THRESHOLD_CENTS;
  const warnings: string[] = game.issues.filter((i) => i.severity !== 'info').map((i) => i.message);
  const tiers = game.tiers;
  const price = game.priceCents;
  const printed = game.totalTicketsPrinted;

  const maxCents = tiers.length ? Math.max(...tiers.map((t) => t.prizeCents)) : 0;
  const topTiers = tiers.filter((t) => t.prizeCents === maxCents);
  const majorTiers = tiers.filter((t) => headline(t) >= majorThresholdCents);
  const profitTiers = tiers.filter((t) => t.kind !== 'free_ticket' && t.prizeCents > price);

  const tickets = estimateTickets(game);
  const T = tickets.available ? tickets.ticketsRemaining : null;
  const remFrac = tickets.available ? tickets.remainingFraction : null;

  const topStats = group(topTiers);
  const majorStats = group(majorTiers);
  const allStats = group(tiers);
  const profit = group(profitTiers);

  const originalEvCents = printed ? evFrom(tiers, (t) => t.original, printed) : null;
  const currentEvCents = T ? evFrom(tiers, (t) => t.remaining, T) : null;
  if (currentEvCents != null && currentEvCents > price) {
    warnings.push('Estimated current EV exceeds the ticket price. This usually means prizes were won but not yet claimed, or the sales estimate is off; treat with caution.');
  }

  const retention = (pct: number | null) => (pct != null && remFrac ? pct / remFrac : null);

  const top = topTiers[0];
  const tierAnalyses: TierAnalysis[] = tiers.map((t) => ({
    ...t,
    headlineCents: headline(t),
    claimedCount: t.original - t.remaining,
    pctRemaining: t.original > 0 ? t.remaining / t.original : null,
    valueRemainingCents: t.remaining * t.prizeCents,
    valueOriginalCents: t.original * t.prizeCents,
    isTop: t.prizeCents === maxCents,
    isMajor: headline(t) >= majorThresholdCents,
    currentOddsOneIn: oneIn(T, t.remaining),
    originalOddsOneIn: oneIn(printed, t.original),
  }));

  return {
    gameId: game.gameId,
    gameNumber: game.gameNumber,
    name: game.name,
    priceCents: price,
    status: game.status,
    launchDate: game.launchDate,
    totalTicketsPrinted: printed,
    topPrize: {
      label: top?.description ?? '—',
      headlineCents: top ? headline(top) : 0,
      cashCents: top?.prizeCents ?? 0,
      kind: top?.kind ?? 'cash',
      ...topStats,
    },
    allPrizes: allStats,
    major: { ...majorStats, thresholdCents: majorThresholdCents, tierCount: majorTiers.length },
    majorBreakdown: MAJOR_THRESHOLDS_CENTS.map((th) => ({ thresholdCents: th, ...group(tiers.filter((t) => headline(t) >= th)) })).filter((b) => b.original > 0),
    tickets,
    originalEvCents,
    originalReturn: originalEvCents != null ? originalEvCents / price : null,
    currentEvCents,
    currentReturn: currentEvCents != null ? currentEvCents / price : null,
    expectedLossCents: currentEvCents != null ? price - currentEvCents : null,
    originalOddsAnyOneIn: oneIn(printed, allStats.original),
    currentOddsAnyOneIn: oneIn(T, allStats.remaining),
    currentOddsProfitOneIn: oneIn(T, profit.remaining),
    originalOddsProfitOneIn: oneIn(printed, profit.original),
    currentOddsTopOneIn: oneIn(T, topStats.remaining),
    originalOddsTopOneIn: oneIn(printed, topStats.original),
    currentOddsMajorOneIn: oneIn(T, majorStats.remaining),
    topRetention: retention(topStats.pctRemaining),
    majorRetention: majorTiers.length ? retention(majorStats.pctRemaining) : null,
    valueRetention: retention(allStats.valueOriginalCents > 0 ? allStats.valueRemainingCents / allStats.valueOriginalCents : null),
    prizeToTicketRatio: allStats.valueRemainingCents / price,
    tiers: tierAnalyses,
    warnings,
  };
}
