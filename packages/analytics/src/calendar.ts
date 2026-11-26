import { CLAIM_WINDOW_MS, type NormalizedGame } from '@nj/lottery-data/types';
import { computeGameMetrics } from './metrics.ts';

export interface CalendarGame {
  gameId: string;
  gameNumber: string;
  name: string;
  priceCents: number;
  topPrizeLabel: string;
  topPrizeOriginal: number;
  topPrizeRemaining: number;
}

export interface Calendar {
  /** Announced games with a future launch date, soonest first. */
  upcoming: Array<CalendarGame & { launchDate: number; launchReturn: number | null; oddsAnyOneIn: number | null; ticketsPrinted: number | null }>;
  /** Games on sale now, ordered by the date sales stop (soonest first). */
  salesEnding: Array<CalendarGame & { salesEndDate: number; daysLeft: number }>;
  /** Games no longer sold whose prizes can still be claimed, ordered by the last day to claim. */
  claimDeadlines: Array<CalendarGame & { salesEndedOn: number; lastDayToClaim: number; daysLeft: number }>;
}

const DAY = 86_400_000;

function base(g: NormalizedGame): CalendarGame {
  const max = Math.max(0, ...g.tiers.map((t) => t.prizeCents));
  const top = g.tiers.filter((t) => t.prizeCents === max);
  return {
    gameId: g.gameId,
    gameNumber: g.gameNumber,
    name: g.name,
    priceCents: g.priceCents,
    topPrizeLabel: top[0]?.description ?? '—',
    topPrizeOriginal: top.reduce((n, t) => n + t.original, 0),
    topPrizeRemaining: top.reduce((n, t) => n + t.remaining, 0),
  };
}

/** Launches, end of sales and claim deadlines, using the same date rules as njlottery.com's tabs. */
export function buildCalendar(games: NormalizedGame[], now: number): Calendar {
  const upcoming = games
    .filter((g) => g.status === 'upcoming' && g.launchDate != null)
    .map((g) => {
      const m = computeGameMetrics(g);
      return { ...base(g), launchDate: g.launchDate!, launchReturn: m.originalReturn, oddsAnyOneIn: m.originalOddsAnyOneIn, ticketsPrinted: g.totalTicketsPrinted };
    })
    .sort((a, b) => a.launchDate - b.launchDate);
  const salesEnding = games
    .filter((g) => g.status === 'active' && g.disableDate != null)
    .map((g) => {
      const salesEndDate = g.disableDate! - CLAIM_WINDOW_MS;
      return { ...base(g), salesEndDate, daysLeft: Math.ceil((salesEndDate - now) / DAY) };
    })
    .sort((a, b) => a.salesEndDate - b.salesEndDate);
  const claimDeadlines = games
    .filter((g) => g.status === 'ended' && g.disableDate != null)
    .map((g) => ({ ...base(g), salesEndedOn: g.disableDate! - CLAIM_WINDOW_MS, lastDayToClaim: g.disableDate!, daysLeft: Math.ceil((g.disableDate! - now) / DAY) }))
    .sort((a, b) => a.lastDayToClaim - b.lastDayToClaim);
  return { upcoming, salesEnding, claimDeadlines };
}
