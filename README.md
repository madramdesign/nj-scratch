# NJ Scratch-Off Tracker

**Live site:** https://madramdesign.github.io/nj-scratch/ (updates every 6 hours)

A data-driven dashboard that answers one question:

> **Which currently active New Jersey scratch-off games have the strongest remaining-prize profile, relative to their cost and to the other games available right now?**

It reads the **official NJ Lottery instant-games API** (the same JSON njlottery.com uses), keeps append-only historical snapshots, computes EV and prize-availability metrics, and ranks games with a transparent, adjustable score. Every estimate is labeled; nothing is fabricated.

> Scratch-off tickets are gambling products and the lottery keeps a house edge. Every active game returns less than it costs on average. Rankings describe official remaining-prize data and are not predictions. If gambling is a problem, call 1-800-GAMBLER.

## Features

- **Best Tickets:** summary cards, the top 3 with data-driven "why it ranks highly" text, and rankings by overall score, EV, jackpot availability, major-prize availability and value per dollar. Adjustable weights and major-prize threshold.
- **All Games:** every active game with full metrics, filters (price, minimum top/major %, score, EV, prize value, top prize, maximum price, profile, search) and sorting (score, EV, EV %, price, top prize, top/major/all %, value, odds, prize ratio, recently changed).
- **Jackpot Hunters, Best by Price ($1–$100), Best Odds** (any prize vs. *winning more than cost*), **Remaining %**, and **Tickets to Avoid** with reasons.
- **Game detail:** recommendation with strengths and weaknesses, key numbers, break-even analysis, full prize table, distribution chart, score breakdown, history charts (top/major prizes, prize value, score, EV) and detected changes.
- **History and change detection:** snapshots on every data change; events such as "2 × $100,000 prizes claimed" or "Score decreased from 82 → 76". The history is backfilled from Internet Archive captures of the official API (2024-11 → 2026-02).
- **Watchlist** (☆) with score deltas and alerts.
- **Data quality:** source, last successful and attempted update, data age, games retrieved, games with missing data, a full update log, and a stale-data banner.

## Setup

Requires **Node.js ≥ 22.13** (uses the built-in `node:sqlite`; developed on Node 24).

```bash
npm install
```

```bash
npm run scrape
```

```bash
npm run backfill
```

`scrape` fetches today's official data into `data/njscratch.db`. `backfill` is optional: it imports roughly 9 historical snapshots from the Internet Archive (about 30 seconds).

### Development

```bash
npm run dev
```

The API runs on http://localhost:8787 and the dashboard on http://localhost:5173 (which proxies `/api`).

### Production (single process)

```bash
npm start
```

This builds the web app and serves it and the API from http://localhost:8787.

### Tests

```bash
npm test
```

```bash
npm run typecheck
```

## Hosting (GitHub Pages)

`.github/workflows/update-and-deploy.yml` runs every 6 hours (and on every push to `main`). It restores the SQLite history from the `data` branch, fetches the official NJ data, runs the tests, saves the database back to `data`, exports the API as static JSON (`apps/api/src/export-static.ts`) and deploys to Pages. In the hosted build (`VITE_STATIC=1`), custom weights are re-scored in the browser, the watchlist is stored in the browser, and the manual refresh button is replaced by the automatic schedule. To run an update right away: **Actions → Update data & deploy site → Run workflow**.

**Backups:** every run adds a commit to the `data` branch, so each earlier copy of the database is kept. A copy that fails SQLite's integrity check or has fewer history rows than the previous backup is never saved (`packages/scraper/src/verify-db.ts`), and the run fails instead. To restore an earlier copy:

```bash
git fetch origin data
```

```bash
git log --oneline FETCH_HEAD
```

```bash
git show <commit>:njscratch.db > data/njscratch.db
```

To put a restored copy back online, commit it on top of the `data` branch and push.

## Updating data

- **Automatic:** the API process checks njlottery.com every `UPDATE_INTERVAL_HOURS` (default 6), and right away on startup if the last check is older than that. Failures retry after 30 minutes. Identical responses are logged as `unchanged`.
- **Manual (dev/admin):** the **↻ Refresh data** button, or `POST /api/refresh`. This is rate limited to once every 5 minutes. Set `ADMIN_TOKEN` to require `Authorization: Bearer <token>`.
- **CLI / cron:** `npm run scrape` exits non-zero on failure, so it can run from cron or launchd, for example:
  ```cron
  15 */6 * * * cd /path/to/nj-scratch && npm run scrape >> data/scrape.log 2>&1
  ```
  If you schedule it externally, set `DISABLE_SCHEDULER=1` for the API.

If NJ changes its response format, updates **fail loudly**: the run is recorded as failed, nothing is written, and the dashboard keeps the last good data with a staleness warning.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 8787 | API port |
| `NJ_DB_PATH` | `data/njscratch.db` | SQLite file |
| `UPDATE_INTERVAL_HOURS` | 6 | scheduler interval |
| `STALE_AFTER_HOURS` | 36 | when the UI flags data as stale |
| `DISABLE_SCHEDULER` | — | `1` to turn off in-process updates |
| `ADMIN_TOKEN` | — | protects `POST /api/refresh` |

## API

| Endpoint | Description |
|---|---|
| `GET /api/games` | all active games with metrics, score, explanation and data status |
| `GET /api/games/:id` | one game with its prize tiers, events and issues (`01908` and `1908` both work) |
| `GET /api/games/:id/history` | snapshot time series |
| `GET /api/rankings?by=score\|ev\|top\|topPct\|major\|majorPct\|prizesPct\|value\|odds\|profitOdds&limit=` | ranked list |
| `GET /api/rankings/best` · `/worst` · `/by-price` · `/by-price/:dollars` | ranking views |
| `GET /api/statistics` | headline statistics |
| `GET /api/updates` · `GET /api/status` | update log and data-quality status |
| `GET /api/changes?since=&limit=` | change events |
| `GET/POST/DELETE /api/watchlist[/:id]` | watchlist |
| `POST /api/refresh` | manual update |

Scoring options on any analysis endpoint: `?major=<dollars>` and `?w=expectedReturn:35,topPrize:20,majorPrize:20,profitOdds:15,prizeValue:10`.

## Project layout

```
apps/api            Hono API, scheduler, serves built web app
apps/web            React dashboard
packages/lottery-data   official API schema, normalization, validation, formatting
packages/analytics      metrics, EV, ticket estimate, scoring, explanations, change detection
packages/database       SQLite schema, migrations, repository
packages/scraper        fetcher, ingestion pipeline, Internet Archive backfill, CLIs
fixtures/               saved real NJ response (regression) and test builders
docs/                   research, methodology, data dictionary, architecture
```

## Documentation

- [docs/DATA_RESEARCH.md](docs/DATA_RESEARCH.md): how njlottery.com loads data, endpoint and fields, history, limitations
- [docs/GITHUB_RESEARCH.md](docs/GITHUB_RESEARCH.md): existing projects evaluated
- [docs/SCORING_METHODOLOGY.md](docs/SCORING_METHODOLOGY.md): every formula and weight, and why
- [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md): tables and metric fields
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design and key decisions

Not affiliated with or endorsed by the New Jersey Lottery.
