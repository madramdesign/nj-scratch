import { createHash } from 'node:crypto';
import { KNOWN_TIER_TYPES, TIER_TYPE, type RawGame, type RawPrizeTier } from './raw-schema.ts';
import { CLAIM_WINDOW_MS, type DataIssue, type GameStatus, type NormalizedGame, type NormalizedTier, type PrizeKind } from './types.ts';

/** NJ Lottery counts remaining prizes >= $600 from claim-center claims, and smaller ones from paid tickets. */
export const CLAIM_CENTER_THRESHOLD_CENTS = 60_000;
const YEAR_MS = CLAIM_WINDOW_MS;

/**
 * Same windows the official scratch-offs page uses (instantgames.js):
 *  ACTIVE   launchDate <= now < disableDate - 365d
 *  ENDED    disableDate - 365d <= now < disableDate   (no longer sold; prizes still claimable)
 *  EXPIRED  disableDate <= now
 */
export function classifyStatus(game: Pick<RawGame, 'launchDate' | 'disableDate'>, now: number): GameStatus {
  const { launchDate, disableDate } = game;
  if (launchDate == null || disableDate == null) return 'unknown';
  if (launchDate > now) return 'upcoming';
  if (now < disableDate - YEAR_MS) return 'active';
  if (now < disableDate) return 'ended';
  return 'expired';
}

export function prizeKind(tierType: number): PrizeKind {
  if (tierType === TIER_TYPE.FREE_TICKET) return 'free_ticket';
  if (tierType === TIER_TYPE.ANNUITY) return 'annuity';
  return 'cash';
}

/** Parse "$1,000,000*" -> 100000000 cents. Returns null for things like "$10,000 A MONTH/LIF". */
export function parseAdvertisedAmount(description: string | null | undefined): number | null {
  if (!description) return null;
  const m = /^\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*\*?\s*$/.exec(description);
  if (!m) return null;
  const dollars = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

export function padGameId(id: string): string {
  return id.padStart(5, '0');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeTier(raw: RawPrizeTier, gameIssues: DataIssue[]): NormalizedTier {
  const usesClaimed = raw.prizeAmount >= CLAIM_CENTER_THRESHOLD_CENTS;
  const removed = usesClaimed ? raw.claimedTickets : raw.paidTickets;
  let remaining = raw.winningTickets - removed;
  if (remaining < 0) {
    gameIssues.push({
      severity: 'warning',
      code: 'NEGATIVE_REMAINING',
      message: `Tier ${raw.tierNumber} (${raw.prizeDescription ?? raw.prizeAmount}) reports more ${usesClaimed ? 'claimed' : 'paid'} (${removed}) than printed (${raw.winningTickets}); remaining clamped to 0.`,
    });
    remaining = 0;
  }
  if (!KNOWN_TIER_TYPES.has(raw.tierType)) {
    gameIssues.push({
      severity: 'error',
      code: 'UNKNOWN_TIER_TYPE',
      message: `Tier ${raw.tierNumber} has unknown tierType ${raw.tierType}; prize value cannot be interpreted safely.`,
    });
  }
  const kind = prizeKind(raw.tierType);
  return {
    tierNumber: raw.tierNumber,
    prizeCents: raw.prizeAmount,
    advertisedCents: kind === 'annuity' ? parseAdvertisedAmount(raw.prizeDescription) : raw.prizeAmount,
    description: raw.prizeDescription ?? `$${(raw.prizeAmount / 100).toLocaleString('en-US')}`,
    tierType: raw.tierType,
    kind,
    original: raw.winningTickets,
    paid: raw.paidTickets,
    claimed: raw.claimedTickets,
    remaining,
    remainingBasis: usesClaimed ? 'claimed' : 'paid',
  };
}

export function normalizeGame(raw: RawGame, now: number): NormalizedGame {
  const issues: DataIssue[] = [];
  const status = classifyStatus(raw, now);
  const tiers = (raw.prizeTiers ?? []).map((t) => normalizeTier(t, issues)).sort((a, b) => b.prizeCents - a.prizeCents || b.tierNumber - a.tierNumber);

  if (!raw.prizeTiers || raw.prizeTiers.length === 0) {
    issues.push({ severity: 'error', code: 'NO_PRIZE_TIERS', message: 'No prize tiers were published for this game.' });
  }
  const tierNumbers = new Set<number>();
  for (const t of tiers) {
    if (tierNumbers.has(t.tierNumber)) {
      issues.push({ severity: 'error', code: 'DUPLICATE_TIER', message: `Tier number ${t.tierNumber} appears more than once.` });
    }
    tierNumbers.add(t.tierNumber);
  }
  if (!raw.totalTicketsPrinted) {
    issues.push({ severity: 'warning', code: 'NO_TICKETS_PRINTED', message: 'Total tickets printed is missing; odds and EV cannot be computed exactly.' });
  }
  const totalWinners = tiers.reduce((s, t) => s + t.original, 0);
  if (raw.totalTicketsPrinted && totalWinners > raw.totalTicketsPrinted) {
    issues.push({ severity: 'error', code: 'WINNERS_EXCEED_PRINTED', message: `Total winning tickets (${totalWinners}) exceeds tickets printed (${raw.totalTicketsPrinted}).` });
  }
  for (const t of tiers) {
    if (t.kind === 'free_ticket' && t.prizeCents !== raw.ticketPrice) {
      issues.push({ severity: 'info', code: 'FREE_TICKET_PRICE_MISMATCH', message: `Free-ticket tier ${t.tierNumber} is valued at ${t.prizeCents}¢ but the game costs ${raw.ticketPrice}¢.` });
    }
  }

  const canonical = {
    gameId: raw.gameId,
    gameName: raw.gameName,
    ticketPrice: raw.ticketPrice,
    totalTicketsPrinted: raw.totalTicketsPrinted ?? null,
    launchDate: raw.launchDate,
    disableDate: raw.disableDate,
    validationStatus: raw.validationStatus,
    prizeTiers: (raw.prizeTiers ?? []).map((t) => ({ ...t })).sort((a, b) => a.tierNumber - b.tierNumber),
  };

  return {
    gameId: raw.gameId,
    gameNumber: padGameId(raw.gameId),
    name: raw.gameName.trim(),
    priceCents: raw.ticketPrice,
    launchDate: raw.launchDate,
    startDistributionDate: raw.startDistributionDate ?? null,
    endDistributionDate: raw.endDistributionDate ?? null,
    disableDate: raw.disableDate,
    totalTicketsPrinted: raw.totalTicketsPrinted ?? null,
    validationStatus: raw.validationStatus,
    status,
    tiers,
    issues,
    dataHash: hashValue(canonical),
  };
}
