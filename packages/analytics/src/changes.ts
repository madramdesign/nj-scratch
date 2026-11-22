import { formatInt, formatMoney } from '@nj/lottery-data/format';
import type { NormalizedGame } from '@nj/lottery-data/types';

export type ChangeKind = 'prizes_claimed' | 'top_prize_claimed' | 'major_prize_claimed' | 'structure_changed' | 'score_changed' | 'game_added' | 'game_removed' | 'status_changed';

export interface ChangeEvent {
  gameId: string;
  kind: ChangeKind;
  severity: 'info' | 'notable' | 'warning';
  message: string;
  tierNumber?: number;
  delta?: number;
}

/**
 * Compare two observations of the same game. Remaining counts normally only go down; an increase
 * or a change in the ORIGINAL counts means NJ revised the prize structure and is surfaced as a warning.
 */
export function diffGame(prev: NormalizedGame, curr: NormalizedGame, majorThresholdCents = 1_000_000): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const prevTiers = new Map(prev.tiers.map((t) => [t.tierNumber, t]));
  const maxCents = Math.max(0, ...curr.tiers.map((t) => t.prizeCents));
  let smallClaimed = 0;
  for (const t of curr.tiers) {
    const p = prevTiers.get(t.tierNumber);
    if (!p) {
      events.push({ gameId: curr.gameId, kind: 'structure_changed', severity: 'warning', tierNumber: t.tierNumber, message: `New prize tier ${t.description} appeared.` });
      continue;
    }
    if (p.original !== t.original || p.prizeCents !== t.prizeCents) {
      events.push({
        gameId: curr.gameId,
        kind: 'structure_changed',
        severity: 'warning',
        tierNumber: t.tierNumber,
        message: `Prize tier ${t.description} changed: ${formatInt(p.original)} × ${formatMoney(p.prizeCents)} → ${formatInt(t.original)} × ${formatMoney(t.prizeCents)}.`,
      });
    }
    const delta = p.remaining - t.remaining;
    if (delta < 0) {
      events.push({ gameId: curr.gameId, kind: 'structure_changed', severity: 'warning', tierNumber: t.tierNumber, delta, message: `Remaining ${t.description} prizes increased by ${formatInt(-delta)} (official data revised).` });
    } else if (delta > 0) {
      const headline = t.advertisedCents ?? t.prizeCents;
      if (t.prizeCents === maxCents) {
        events.push({ gameId: curr.gameId, kind: 'top_prize_claimed', severity: 'notable', tierNumber: t.tierNumber, delta, message: `${formatInt(delta)} × ${t.description} top prize${delta > 1 ? 's' : ''} claimed (${formatInt(t.remaining)} left).` });
      } else if (headline >= majorThresholdCents) {
        events.push({ gameId: curr.gameId, kind: 'major_prize_claimed', severity: 'notable', tierNumber: t.tierNumber, delta, message: `${formatInt(delta)} × ${t.description} prize${delta > 1 ? 's' : ''} claimed (${formatInt(t.remaining)} left).` });
      } else if (t.prizeCents >= 60_000) {
        events.push({ gameId: curr.gameId, kind: 'prizes_claimed', severity: 'info', tierNumber: t.tierNumber, delta, message: `${formatInt(delta)} × ${t.description} prize${delta > 1 ? 's' : ''} claimed.` });
      } else smallClaimed += delta;
    }
  }
  for (const p of prev.tiers) {
    if (!curr.tiers.some((t) => t.tierNumber === p.tierNumber)) {
      events.push({ gameId: curr.gameId, kind: 'structure_changed', severity: 'warning', tierNumber: p.tierNumber, message: `Prize tier ${p.description} disappeared from the official data.` });
    }
  }
  if (smallClaimed > 0) {
    events.push({ gameId: curr.gameId, kind: 'prizes_claimed', severity: 'info', delta: smallClaimed, message: `${formatInt(smallClaimed)} smaller prizes (under $600) paid.` });
  }
  if (prev.status !== curr.status) {
    events.push({ gameId: curr.gameId, kind: 'status_changed', severity: 'notable', message: `Status changed from ${prev.status} to ${curr.status}.` });
  }
  return events;
}

export function scoreChangeEvent(gameId: string, prev: number | null, curr: number | null, threshold = 5): ChangeEvent | null {
  if (prev == null || curr == null) return null;
  const d = curr - prev;
  if (Math.abs(d) < threshold) return null;
  return {
    gameId,
    kind: 'score_changed',
    severity: 'notable',
    delta: d,
    message: `Score ${d > 0 ? 'increased' : 'decreased'} from ${prev.toFixed(0)} → ${curr.toFixed(0)}.`,
  };
}
