import { formatMoney, formatPct, formatInt } from '@nj/lottery-data/format';
import type { GameMetrics } from './metrics.ts';
import type { GameScore } from './scoring.ts';

export interface Explanation {
  headline: string;
  emoji: '🟢' | '🟡' | '🔴' | '⚪';
  strengths: string[];
  weaknesses: string[];
  /** Short reasons used by the "Tickets to avoid" view. */
  avoidReasons: string[];
}

const HEADLINES: Record<GameScore['label'], [Explanation['emoji'], string]> = {
  strong: ['🟢', 'Strong remaining-prize profile'],
  average: ['🟡', 'Average remaining-prize profile'],
  weak: ['🔴', 'Weak remaining-prize profile'],
  unrated: ['⚪', 'Not enough data to rate'],
};

function median(xs: number[]): number | null {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const plural = (n: number, word: string) => `${formatInt(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * Data-driven explanation. Every sentence is computed from the metrics; no claim is made that
 * isn't directly supported by the official counts (or explicitly labeled as an estimate).
 */
export function explainGame(m: GameMetrics, s: GameScore | undefined, peers: GameMetrics[]): Explanation {
  const [emoji, headline] = HEADLINES[s?.label ?? 'unrated'];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const avoidReasons: string[] = [];
  const samePrice = peers.filter((p) => p.priceCents === m.priceCents);
  const priceLabel = formatMoney(m.priceCents);
  const tix = m.tickets.available ? m.tickets : null;

  // Top prize
  const tp = m.topPrize;
  const topLine = `${formatInt(tp.remaining)} of ${formatInt(tp.original)} top prizes (${tp.label}) remain`;
  if (tp.remaining === 0) {
    weaknesses.push(`All ${plural(tp.original, 'top prize')} (${tp.label}) have been claimed.`);
    avoidReasons.push('Top prize fully claimed');
  } else if (m.topRetention != null && tix) {
    const rel = m.topRetention;
    const sentence = `${topLine} (${formatPct(tp.pctRemaining, 0)}), while an estimated ${formatPct(tix.remainingFraction, 0)} of tickets are left`;
    if (rel >= 1.15) strengths.push(`${sentence}, so top-prize odds are about ${rel.toFixed(1)}× better than at launch.`);
    else if (rel <= 0.75) {
      weaknesses.push(`${sentence}, so top-prize odds are about ${(1 / rel).toFixed(1)}× worse than at launch.`);
      avoidReasons.push('Top prizes claimed faster than tickets sold');
    } else strengths.push(`${sentence}, roughly in line with sales.`);
  } else if (tp.pctRemaining != null) {
    (tp.pctRemaining >= 0.5 ? strengths : weaknesses).push(`${topLine} (${formatPct(tp.pctRemaining, 0)}).`);
  }

  // Major prizes
  if (m.major.tierCount > 0 && m.major.pctRemaining != null) {
    const th = formatMoney(m.major.thresholdCents, { compact: true });
    if (m.majorRetention != null && m.majorRetention >= 1.15) {
      strengths.push(`${formatPct(m.major.pctRemaining, 0)} of ${th}+ prizes remain (${formatInt(m.major.remaining)} of ${formatInt(m.major.original)}), more than the share of tickets still unsold.`);
    } else if (m.majorRetention != null && m.majorRetention <= 0.75) {
      weaknesses.push(`Only ${formatPct(m.major.pctRemaining, 0)} of ${th}+ prizes remain (${formatInt(m.major.remaining)} of ${formatInt(m.major.original)}); ${formatPct(1 - m.major.pctRemaining, 0)} have been claimed.`);
      avoidReasons.push('Major prizes depleted');
    }
  }

  // Expected value
  if (m.currentReturn != null) {
    const med = median(samePrice.map((p) => p.currentReturn ?? NaN));
    const allMed = median(peers.map((p) => p.currentReturn ?? NaN));
    const evText = `Estimated return is ${formatPct(m.currentReturn)} (${formatMoney(Math.round(m.currentEvCents!), { decimals: true })} per ${priceLabel} ticket)`;
    if (med != null && samePrice.length > 2 && m.currentReturn >= med + 0.02) strengths.push(`${evText}, above the ${priceLabel}-ticket median of ${formatPct(med)}.`);
    else if (med != null && samePrice.length > 2 && m.currentReturn <= med - 0.02) {
      weaknesses.push(`${evText}, below the ${priceLabel}-ticket median of ${formatPct(med)}.`);
      avoidReasons.push('Below-average expected return for its price');
    } else if (allMed != null && m.currentReturn >= allMed + 0.03) strengths.push(`${evText}, above the all-games median of ${formatPct(allMed)}.`);
    else if (allMed != null && m.currentReturn <= allMed - 0.03) {
      weaknesses.push(`${evText}, below the all-games median of ${formatPct(allMed)}.`);
      avoidReasons.push('Poor expected value');
    }
    if (m.originalReturn != null && m.currentReturn - m.originalReturn >= 0.03) {
      strengths.push(`Estimated return has improved from ${formatPct(m.originalReturn)} at launch as lower prizes were paid out faster than larger ones.`);
    } else if (m.originalReturn != null && m.originalReturn - m.currentReturn >= 0.03) {
      weaknesses.push(`Estimated return has fallen from ${formatPct(m.originalReturn)} at launch.`);
    }
  } else if (!m.tickets.available) {
    weaknesses.push(`Expected value can't be estimated: ${m.tickets.reason}`);
  }

  if (m.valueRetention != null && m.valueRetention <= 0.8) {
    avoidReasons.push('Low remaining prize value relative to tickets left');
  }
  if (tix && tix.remainingFraction < 0.1) {
    weaknesses.push(`Only about ${formatPct(tix.remainingFraction, 0)} of tickets are estimated to remain; the game is near the end of its run.`);
  }
  if (s?.rankInPrice && s.peersInPrice > 1) {
    const line = `Ranks #${s.rankInPrice} of ${s.peersInPrice} active ${priceLabel} games.`;
    (s.rankInPrice <= Math.ceil(s.peersInPrice / 3) ? strengths : s.rankInPrice > (2 * s.peersInPrice) / 3 ? weaknesses : strengths).push(line);
  }
  if (s?.capped) weaknesses.push('Score capped because no top prizes remain.');

  return { headline, emoji, strengths, weaknesses, avoidReasons: [...new Set(avoidReasons)] };
}
