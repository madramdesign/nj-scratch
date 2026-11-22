import { RawGamesResponseSchema, type RawGame } from './raw-schema.ts';
import { hashValue, normalizeGame } from './normalize.ts';
import { hasBlockingIssue, type DataIssue, type NormalizedGame } from './types.ts';

export class DataValidationError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(details.length ? `${message}\n - ${details.slice(0, 20).join('\n - ')}` : message);
    this.name = 'DataValidationError';
  }
}

export interface ParseOptions {
  now: number;
  /** Below this many games total, assume the endpoint changed or returned a partial page. */
  minTotalGames?: number;
  /** Below this many active games, assume something is wrong. */
  minActiveGames?: number;
}

export interface ParseReport {
  totalGames: number;
  activeGames: number;
  /** Active games that passed validation and can be ranked. */
  rankableActiveGames: number;
  /** Active games excluded because of blocking data problems. */
  invalidActiveGames: number;
  duplicateGameIds: string[];
  issues: Array<DataIssue & { gameId?: string }>;
  payloadHash: string;
}

export interface ParseResult {
  games: NormalizedGame[];
  report: ParseReport;
}

/**
 * Validate and normalize a raw API payload. Throws DataValidationError when the payload
 * is structurally wrong — callers must NOT fall back to partially parsed data in that case.
 */
export function parseGamesResponse(json: unknown, opts: ParseOptions): ParseResult {
  const { now, minTotalGames = 20, minActiveGames = 10 } = opts;
  const parsed = RawGamesResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new DataValidationError(
      'NJ Lottery response did not match the expected schema (the website may have changed).',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const raw = parsed.data;
  if (raw.nextPageUrl) {
    throw new DataValidationError('NJ Lottery response is paginated (nextPageUrl present); refusing to rank a partial game list.');
  }
  if (raw.games.length < minTotalGames) {
    throw new DataValidationError(`Only ${raw.games.length} games returned (expected at least ${minTotalGames}).`);
  }

  // Duplicate detection: identical duplicates are collapsed, conflicting duplicates are fatal.
  const byId = new Map<string, RawGame>();
  const duplicateGameIds: string[] = [];
  const conflicts: string[] = [];
  for (const g of raw.games) {
    const prev = byId.get(g.gameId);
    if (prev) {
      duplicateGameIds.push(g.gameId);
      if (hashValue(prev) !== hashValue(g)) conflicts.push(`Game ${g.gameId} appears twice with different data`);
      continue;
    }
    byId.set(g.gameId, g);
  }
  if (conflicts.length) throw new DataValidationError('Conflicting duplicate games in NJ Lottery response.', conflicts);

  const games = [...byId.values()].map((g) => normalizeGame(g, now));
  const active = games.filter((g) => g.status === 'active');
  if (active.length < minActiveGames) {
    throw new DataValidationError(`Only ${active.length} active games found (expected at least ${minActiveGames}).`);
  }
  const invalidActive = active.filter(hasBlockingIssue);
  // If a large share of active games is broken, the source format probably changed: fail loudly.
  if (invalidActive.length > Math.max(3, active.length * 0.2)) {
    throw new DataValidationError(
      `${invalidActive.length} of ${active.length} active games failed validation; refusing to publish rankings.`,
      invalidActive.flatMap((g) => g.issues.filter((i) => i.severity === 'error').map((i) => `${g.gameNumber}: ${i.message}`)),
    );
  }

  const issues = games.flatMap((g) => g.issues.map((i) => ({ ...i, gameId: g.gameId })));
  for (const id of duplicateGameIds) {
    issues.push({ severity: 'warning', code: 'DUPLICATE_GAME', message: `Game ${id} appeared more than once (identical copies collapsed).`, gameId: id });
  }

  return {
    games,
    report: {
      totalGames: games.length,
      activeGames: active.length,
      rankableActiveGames: active.length - invalidActive.length,
      invalidActiveGames: invalidActive.length,
      duplicateGameIds,
      issues,
      payloadHash: hashValue(raw.games),
    },
  };
}
