/**
 * "If I buy N tickets of this game" probabilities, from the remaining prize counts and the estimated
 * tickets remaining. Browser-safe, pure.
 *
 * - "At least one prize of value ≥ X" is exact (hypergeometric: drawing N tickets without replacement
 *   from T remaining tickets of which K win such a prize): 1 − Π_{i<N} (T − K − i) / (T − i).
 * - "Net profit over the N tickets" convolves the per-ticket prize distribution N times. Tickets are treated
 *   as independent draws, which differs from the exact answer by well under 0.01% when T is in the
 *   hundreds of thousands and N ≤ 50.
 * A free-ticket prize is counted as getting the ticket price back (it is exchanged for another ticket).
 */
export interface SessionTier {
  prizeCents: number;
  remaining: number;
  kind: 'cash' | 'free_ticket' | 'annuity';
}

export interface SessionInput {
  priceCents: number;
  ticketsRemaining: number;
  tiers: SessionTier[];
  /** Expected value of one ticket (cents), used for the expected-loss figure. */
  evCents: number | null;
}

export interface Threshold {
  minCents: number;
  label: string;
  probability: number;
}

export interface SessionResult {
  tickets: number;
  costCents: number;
  /** Chance at least one ticket wins anything (including a free ticket). */
  pAnyPrize: number;
  /** Chance at least one ticket wins a cash prize larger than the ticket price. */
  pAnyProfitPrize: number;
  /** Chance the total won exceeds the total spent. */
  pNetProfit: number;
  /** Chance of getting at least the money spent back. */
  pBreakEvenOrBetter: number;
  /** Chance every ticket loses. */
  pAllLose: number;
  thresholds: Threshold[];
  expectedLossCents: number | null;
}

export const MAX_SESSION_TICKETS = 50;

/** P(no successes) when drawing n of T without replacement and K are successes. */
export function pNoneHypergeometric(K: number, T: number, n: number): number {
  if (K <= 0) return 1;
  if (n > T - K) return 0;
  let p = 1;
  for (let i = 0; i < n; i++) p *= (T - K - i) / (T - i);
  return p;
}

const valueOf = (t: SessionTier, priceCents: number) => (t.kind === 'free_ticket' ? priceCents : t.prizeCents);

/**
 * Distribution of the total won by N tickets, on a whole-dollar grid from $0 up to the total spent;
 * anything above the total spent is collected in one "more than spent" bucket.
 */
function totalWonDistribution(input: SessionInput, n: number) {
  const T = input.ticketsRemaining;
  const capDollars = Math.ceil((n * input.priceCents) / 100);
  const outcomes: Array<{ dollars: number; p: number }> = [];
  let pWin = 0;
  for (const t of input.tiers) {
    if (t.remaining <= 0) continue;
    const p = t.remaining / T;
    pWin += p;
    outcomes.push({ dollars: Math.floor(valueOf(t, input.priceCents) / 100), p });
  }
  outcomes.push({ dollars: 0, p: Math.max(0, 1 - pWin) });
  let dist = new Float64Array(capDollars + 2); // index capDollars+1 = "more than spent"
  dist[0] = 1;
  const over = capDollars + 1;
  for (let k = 0; k < n; k++) {
    const next = new Float64Array(capDollars + 2);
    for (let s = 0; s <= over; s++) {
      const ps = dist[s];
      if (ps === 0) continue;
      if (s === over) {
        next[over] += ps;
        continue;
      }
      for (const o of outcomes) {
        const t = s + o.dollars;
        next[t > capDollars ? over : t] += ps * o.p;
      }
    }
    dist = next;
  }
  return { dist, capDollars, over };
}

export function sessionOdds(input: SessionInput, n: number, thresholdsCents: number[] = [10_000, 100_000, 1_000_000]): SessionResult | null {
  const T = Math.floor(input.ticketsRemaining);
  if (!(T > 0) || !(n >= 1) || n > MAX_SESSION_TICKETS || n > T) return null;
  const n0 = Math.floor(n);
  const sum = (f: (t: SessionTier) => boolean) => input.tiers.filter(f).reduce((s, t) => s + Math.max(0, t.remaining), 0);
  const allWinners = sum(() => true);
  const profitWinners = sum((t) => t.kind !== 'free_ticket' && t.prizeCents > input.priceCents);
  const maxPrize = Math.max(0, ...input.tiers.filter((t) => t.remaining > 0).map((t) => t.prizeCents));

  const thresholds: Threshold[] = thresholdsCents
    .filter((c) => c > input.priceCents && c <= maxPrize)
    .map((c) => ({
      minCents: c,
      label: `$${(c / 100).toLocaleString('en-US')} or more`,
      probability: 1 - pNoneHypergeometric(sum((t) => t.kind !== 'free_ticket' && t.prizeCents >= c), T, n0),
    }));

  const costCents = n0 * input.priceCents;
  const { dist, capDollars, over } = totalWonDistribution({ ...input, ticketsRemaining: T }, n0);
  const costDollars = costCents / 100;
  let pNetProfit = dist[over];
  let pBreakEven = dist[over];
  for (let s = 0; s <= capDollars; s++) {
    if (s > costDollars) pNetProfit += dist[s];
    if (s >= costDollars) pBreakEven += dist[s];
  }
  const pAllLose = pNoneHypergeometric(allWinners, T, n0);
  return {
    tickets: n0,
    costCents,
    pAnyPrize: 1 - pAllLose,
    pAnyProfitPrize: 1 - pNoneHypergeometric(profitWinners, T, n0),
    pNetProfit: Math.min(1, pNetProfit),
    pBreakEvenOrBetter: Math.min(1, pBreakEven),
    pAllLose,
    thresholds,
    expectedLossCents: input.evCents == null ? null : n0 * (input.priceCents - input.evCents),
  };
}
