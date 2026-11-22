# Architecture

```
            ┌──────────── scheduler (in API process, every 6h) / npm run scrape / POST /api/refresh
            ▼
 njlottery.com /api/v1/instant-games/games/?size=1000          Internet Archive captures (npm run backfill)
            │  packages/scraper/fetcher.ts (UA, timeout, retry 2s/4s/8s on 5xx/429/network)   │
            ▼                                                                                  ▼
 packages/lottery-data   raw zod schema → parseGamesResponse() → NormalizedGame[]  (fails loudly)
            │
            ▼
 packages/scraper/ingest.ts   one SQLite transaction:
            │   raw_payloads (gzip, dedupe by hash) → games / prize_tiers → game_snapshots + prize_snapshots
            │   → analytics (default weights) → scoring_snapshots → diff vs previous snapshot → change_events
            ▼
 packages/database (node:sqlite, forward-only migrations)
            │
            ▼
 apps/api (Hono)   DashboardService: latest data run → re-normalize at "now" → analyzeGames(weights, threshold), cached
            │      /api/games, /api/games/:id[/history], /api/rankings/*, /api/statistics, /api/updates, /api/changes, /api/watchlist, /api/refresh
            ▼
 apps/web (React + Vite + Recharts)   views: Best · All · Jackpots · By price · Odds · Remaining % · Avoid · Watchlist · Changes · Data quality · Methodology · Game detail
```

## Packages

| Package | Responsibility | Node-only? |
|---|---|---|
| `packages/lottery-data` | Raw API schema (zod), normalization (official remaining formula, status windows), payload validation, formatting helpers | `normalize.ts` and `parse.ts` use `node:crypto`; `format.ts` and `types.ts` are browser-safe subpath exports |
| `packages/analytics` | Metrics, ticket estimate, EV, scoring, explanations, change diffing. Pure functions | No |
| `packages/database` | SQLite schema/migrations, repository functions | Yes (`node:sqlite`, built into Node ≥ 22.13) |
| `packages/scraper` | Fetching, ingestion pipeline, Internet Archive backfill, CLIs | Yes |
| `apps/api` | HTTP API, scheduler, serves the built web app in production | Yes |
| `apps/web` | Dashboard | Browser |

The brief's suggested `packages/ui` was folded into `apps/web/src/components`, since there is only one frontend.

## Key decisions

- **Official JSON API, not HTML scraping.** It is the same data the website renders, it is complete, and its typed fields make structural changes detectable.
- **Fail loudly.** Schema mismatch, pagination, fewer than 20 games, fewer than 10 active games, conflicting duplicates, or more than 20% of active games invalid all produce a *failed run*, and nothing is written. The API keeps serving the last good data, `status.isStale` and `warnings` drive a banner, and the Data Quality page shows the error. A few invalid games are excluded and counted instead.
- **Append-only history.** Snapshots are only inserted. A response identical to one already stored (same payload hash) is logged as `unchanged`, without duplicate snapshots. History therefore only grows when NJ's numbers change.
- **Analysis on read.** Scores depend on user weights and on peers, so they are computed per request (cached per data run × options). Default-weight scores are also stored per snapshot for history charts.
- **Status evaluated at "now".** A game's active/ended status depends on today's date, so current data is re-normalized at request time. Historical snapshots use their observation time.
- **Change events are derivable.** They are computed at ingest against the previous snapshot by *time*, and `rebuildChangeEvents()` can recompute them all, which backfill uses after importing out of order.
- **SQLite via built-in `node:sqlite`.** There is no native build step, and WAL mode is enabled. The repository layer is plain SQL and would port directly to Postgres.

## Database schema

See `packages/database/src/migrations.ts` and DATA_DICTIONARY.md. Indexes: `game_snapshots(game_id, observed_at)`, `game_snapshots(run_id)`, `scoring_snapshots(game_id, observed_at)`, `change_events(observed_at)`, `change_events(game_id, observed_at)`, `update_runs(status, observed_at)`, `update_runs(started_at)`, `games(price_cents)`.

## Testing

`npm test` runs Vitest with two projects:
- **node:** parser, normalization, malformed and duplicate data, regression against the saved real response (`fixtures/nj-instant-games-2026-11-22.json`), metrics against a hand-computed reference game, scoring (including the Game A/B scenario), change detection, fetcher retry behavior, ingestion (success, unchanged, failed, history, backfill ordering), and the API via `app.request`.
- **web (jsdom):** filters, sorting, ranking display, stale-data banner, game detail page, mobile scroll containers.
