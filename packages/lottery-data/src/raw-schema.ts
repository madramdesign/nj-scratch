import { z } from 'zod';

/**
 * Schema for the official NJ Lottery instant-games API:
 *   GET https://www.njlottery.com/api/v1/instant-games/games/?size=1000
 *
 * All money values are integer CENTS. Dates are epoch milliseconds.
 * The schema is intentionally strict about types so that a structural change
 * on the NJ Lottery side fails loudly instead of producing silent garbage.
 */
const count = z.number().int().nonnegative();

export const RawPrizeTierSchema = z.object({
  tierNumber: z.number().int().positive(),
  prizeAmount: count, // cents. For annuity tiers (tierType 16) this is the CASH value.
  winningTickets: count, // original number of prizes printed for this tier
  paidTickets: count, // prizes already paid (retail + claim centers)
  claimedTickets: count, // prizes claimed at claim centers (used by NJ for prizes >= $600)
  prizeDescription: z.string().nullable(),
  originalTierNumber: z.number().int().nullable().optional(),
  tierType: z.number().int(),
});

export const RawGameSchema = z.object({
  gameId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  gameName: z.string().min(1),
  validationStatus: z.string(),
  ticketPrice: z.number().int().positive(), // cents
  launchDate: z.number().int().nullable(),
  startDistributionDate: z.number().int().nullable().optional(),
  endDistributionDate: z.number().int().nullable().optional(),
  disableDate: z.number().int().nullable(),
  prizeTiers: z.array(RawPrizeTierSchema).nullable(),
  totalTicketsPrinted: z.number().int().nonnegative().nullable().optional(),
});

export const RawGamesResponseSchema = z.object({
  games: z.array(RawGameSchema),
  nextPageUrl: z.string().nullable().optional(),
  previousPageUrl: z.string().nullable().optional(),
  pageUrls: z.array(z.string()).nullable().optional(),
  nextItems: z.unknown().optional(),
  previousItems: z.unknown().optional(),
});

export type RawPrizeTier = z.infer<typeof RawPrizeTierSchema>;
export type RawGame = z.infer<typeof RawGameSchema>;
export type RawGamesResponse = z.infer<typeof RawGamesResponseSchema>;

/** tierType values observed in the official data. */
export const TIER_TYPE = {
  CASH: 1,
  FREE_TICKET: 2,
  ANNUITY: 16,
} as const;

export const KNOWN_TIER_TYPES = new Set<number>(Object.values(TIER_TYPE));
