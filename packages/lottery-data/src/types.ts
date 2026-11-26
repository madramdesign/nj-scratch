export type GameStatus = 'active' | 'ended' | 'expired' | 'upcoming' | 'unknown';

/** njlottery.com stops selling a game 365 days before its `disableDate`; prizes can be claimed until `disableDate`. */
export const CLAIM_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
export type PrizeKind = 'cash' | 'free_ticket' | 'annuity';

export interface DataIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface NormalizedTier {
  tierNumber: number;
  /** Prize value in cents used for math. For annuity tiers this is NJ's published cash value. */
  prizeCents: number;
  /** Advertised (headline) value in cents, e.g. $1,000,000 for an annuity; null if not parseable. */
  advertisedCents: number | null;
  description: string;
  tierType: number;
  kind: PrizeKind;
  /** Original number of winning tickets printed for this tier (official). */
  original: number;
  paid: number;
  claimed: number;
  /** Remaining prizes, computed with the same formula as njlottery.com. */
  remaining: number;
  remainingBasis: 'claimed' | 'paid';
}

export interface NormalizedGame {
  gameId: string;
  /** Zero-padded game number as shown on njlottery.com (e.g. "01851"). */
  gameNumber: string;
  name: string;
  priceCents: number;
  launchDate: number | null;
  startDistributionDate: number | null;
  endDistributionDate: number | null;
  disableDate: number | null;
  totalTicketsPrinted: number | null;
  validationStatus: string;
  status: GameStatus;
  /** Sorted by prize value, highest first. */
  tiers: NormalizedTier[];
  issues: DataIssue[];
  /** sha256 over the canonical raw record; changes whenever NJ changes any number for this game. */
  dataHash: string;
}

export function hasBlockingIssue(g: NormalizedGame): boolean {
  return g.issues.some((i) => i.severity === 'error');
}
