import type { NormalizedGame } from '@nj/lottery-data/types';
import { computeGameMetrics, type GameMetrics } from './metrics.ts';
import { scoreGames, type GameScore, type ScoringOptions } from './scoring.ts';
import { explainGame, type Explanation } from './explain.ts';

export interface AnalyzedGame {
  metrics: GameMetrics;
  score: GameScore;
  explanation: Explanation;
}

export interface AnalyzeOptions extends ScoringOptions {
  majorThresholdCents?: number;
}

const blocking = (g: NormalizedGame) => g.issues.some((i) => i.severity === 'error');

/**
 * Full pipeline for a set of games: metrics → peer-relative scores → explanations.
 * Only active games without blocking data issues are compared against each other.
 */
export function analyzeGames(games: NormalizedGame[], opts: AnalyzeOptions = {}): AnalyzedGame[] {
  const rankable = games.filter((g) => g.status === 'active' && !blocking(g));
  const metrics = rankable.map((g) => computeGameMetrics(g, { majorThresholdCents: opts.majorThresholdCents }));
  const scores = scoreGames(metrics, opts);
  return metrics
    .map((m) => {
      const score = scores.get(m.gameId)!;
      return { metrics: m, score, explanation: explainGame(m, score, metrics) };
    })
    .sort((a, b) => (a.score.rank ?? 1e9) - (b.score.rank ?? 1e9));
}
