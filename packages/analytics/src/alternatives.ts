/**
 * "Better alternative at the same price": other active games at the same ticket price that beat this one
 * on BOTH the overall score and the estimated return, and still have a top prize left. Comparative only;
 * it never claims either game is a good purchase.
 */
export interface AlternativeCandidate {
  gameId: string;
  gameNumber: string;
  name: string;
  priceCents: number;
  currentReturn: number | null;
  topRetention: number | null;
  topPrize: { remaining: number; original: number; label: string };
  score: { score: number | null };
}

export interface Alternative<G extends AlternativeCandidate = AlternativeCandidate> {
  game: G;
  reasons: string[];
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** Minimum score gap (points) for a peer to count as clearly better. */
export const MIN_SCORE_GAP = 5;

export function samePriceAlternatives<G extends AlternativeCandidate>(target: G, games: G[], limit = 2): Alternative<G>[] {
  const t = target;
  if (t.score.score == null) return [];
  return games
    .filter(
      (g) =>
        g.gameId !== t.gameId &&
        g.priceCents === t.priceCents &&
        g.score.score != null &&
        g.score.score >= t.score.score! + MIN_SCORE_GAP &&
        g.currentReturn != null &&
        (t.currentReturn == null || g.currentReturn > t.currentReturn) &&
        g.topPrize.remaining > 0,
    )
    .sort((a, b) => b.score.score! - a.score.score!)
    .slice(0, limit)
    .map((g) => {
      const reasons: string[] = [];
      if (g.currentReturn != null) reasons.push(`higher estimated return (${pct(g.currentReturn)} vs ${t.currentReturn == null ? 'n/a' : pct(t.currentReturn)})`);
      if (g.topRetention != null && (t.topRetention == null || g.topRetention > t.topRetention + 0.1)) {
        reasons.push(`top-prize odds ${g.topRetention.toFixed(1)}× launch vs ${t.topRetention == null ? 'n/a' : `${t.topRetention.toFixed(1)}×`}`);
      }
      if (t.topPrize.remaining === 0) reasons.push(`${g.topPrize.remaining} of ${g.topPrize.original} top prizes (${g.topPrize.label}) left, vs none`);
      return { game: g, reasons };
    });
}
