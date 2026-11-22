import { parseGamesResponse } from '@nj/lottery-data';
import { analyzeGames } from '@nj/analytics';
import { FIXTURE_NOW, loadRealFixture } from '../../../fixtures/testkit.ts';
import type { GameSummary } from '../src/api';

export const analyzed = analyzeGames(parseGamesResponse(loadRealFixture(), { now: FIXTURE_NOW }).games);
export const summaries: GameSummary[] = analyzed.map((a) => {
  const { tiers, ...m } = a.metrics;
  return { ...m, score: a.score, explanation: a.explanation, lastChangeAt: null, recentChanges: 0 };
});

export const status = {
  now: FIXTURE_NOW,
  source: { name: 'NJ', url: 'https://www.njlottery.com/api/v1/instant-games/games/?size=1000', page: '' },
  dataAsOf: FIXTURE_NOW,
  dataSource: 'njlottery-api',
  lastVerifiedAt: FIXTURE_NOW,
  lastSuccessfulCheck: null,
  lastAttempt: null,
  lastFailure: null,
  dataAgeMs: 0,
  isStale: false,
  gamesRetrieved: 304,
  activeGames: 65,
  rankedGames: 65,
  gamesWithMissingData: 0,
  gamesInvalid: 0,
  dataIssues: [],
  warnings: [] as string[],
  history: { games: 1, snapshots: 1, runs: 1, events: 0, historyFirst: null, historyLast: null, historyPoints: 1 },
};

/** Route-based fetch mock: longest matching prefix wins. */
export function mockFetch(routes: Record<string, unknown>) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.startsWith(k));
    if (!key) return new Response(JSON.stringify({ error: 'not mocked: ' + url }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

export const meta = {
  components: [
    { key: 'expectedReturn', label: 'Estimated return per $1', short: 'EV', description: '', defaultWeight: 35 },
    { key: 'topPrize', label: 'Top-prize availability vs. sales', short: 'Top', description: '', defaultWeight: 20 },
  ],
  majorThresholdsCents: [],
  defaultMajorThresholdCents: 1_000_000,
  disclaimer: 'Scratch-off tickets are gambling products.',
};
