# Data dictionary

All money is stored as **integer cents** unless noted. All timestamps are **epoch milliseconds (UTC)**.
"Official" means the value is copied or derived arithmetically from NJ Lottery data. "Estimate" means it depends on the tickets-remaining estimate.

## Tables

### `data_sources`
| Column | Description |
|---|---|
| key | `njlottery-api` (live) or `internet-archive` (captures of the same official API) |
| name, url, is_official | descriptive |

### `update_runs` — one row per update attempt
| Column | Description |
|---|---|
| trigger | `scheduled` / `manual` / `cli` / `backfill` / `test` |
| started_at, finished_at | wall-clock times of the attempt |
| observed_at | when the data is "as of" (fetch time, or archive capture time) |
| status | `running` / `success` (new data stored) / `unchanged` (identical to stored data) / `failed` |
| http_status, payload_hash (sha256 of games array), duration_ms | |
| games_total, games_active, games_rankable, games_invalid | counts from validation |
| issues_json | non-info data issues for active games |
| error | failure message (validation or fetch) |

### `raw_payloads`
Gzipped original response body, one per distinct `payload_hash`. This is the audit trail and allows reprocessing.

### `games` — one row per game ever seen
game_id, game_number (zero-padded), name, price_cents, launch_date, disable_date, total_tickets_printed, first_seen_at, last_seen_at.

### `prize_tiers` — current prize structure
game_id, tier_number, prize_cents (cash value), advertised_cents (headline, null if not parseable), description, tier_type (1 cash, 2 free ticket, 16 annuity), original_count.

### `game_snapshots` — immutable per-game observation
run_id, game_id, observed_at, name, status (`active`/`ended`/`upcoming` at observation time; upcoming games publish full prize tables before launch), validation_status, price_cents, launch/start/end distribution/disable dates, total_tickets_printed, top_prize_cents, top_prize_label, data_hash (sha256 of the canonical raw game). Unique (run_id, game_id).

### `prize_snapshots` — immutable per-tier observation
snapshot_id, tier_number, prize_cents, description, tier_type, original_count, paid_count, claimed_count, remaining_count (official formula).

### `scoring_snapshots` — metrics at ingest (default weights)
snapshot_id, run_id, game_id, observed_at, methodology_version, score, rank, label, current_ev_cents *(estimate)*, current_return *(estimate)*, original_return, top_remaining, top_original, major_remaining, major_original ($10k+), prizes_remaining, value_remaining_cents, tickets_remaining_est *(estimate)*, components_json.

### `change_events`
run_id, game_id, observed_at, kind (`top_prize_claimed`, `top_prize_sold_out`, `major_prize_claimed`, `prizes_claimed`, `score_changed`, `game_added`, `game_announced`, `status_changed`, `structure_changed`), severity (`info`/`notable`/`warning`), message, tier_number, delta.

### `app_meta`
Key/value bookkeeping. `events_version` records which version of the change-event rules (`EVENTS_VERSION` in `packages/analytics/src/changes.ts`) built `change_events`; `npm run scrape` rebuilds all events once when it is older.

### `watchlist`
game_id, added_at, score_at_add, note.

## API metric fields (`GameMetrics`)

| Field | Kind | Definition |
|---|---|---|
| priceCents | official | ticket price |
| topPrize.{label, headlineCents, cashCents, original, remaining, pctRemaining, valueRemainingCents} | official | top tier(s) by prize amount |
| major.{thresholdCents, original, remaining, pctRemaining, tierCount} | official | tiers with headline ≥ threshold |
| majorBreakdown[] | official | same, at $10K/$25K/$50K/$100K/$500K/$1M |
| allPrizes.{original, remaining, pctRemaining, valueOriginalCents, valueRemainingCents} | official | all tiers |
| tickets | estimate | `{available, soldFraction, remainingFraction, ticketsRemaining, confidence, note}` or `{available:false, reason}` |
| originalEvCents / originalReturn | official-derived | EV at launch (exact) |
| currentEvCents / currentReturn / expectedLossCents | estimate | EV now |
| originalOdds{Any,Top,Profit}OneIn | official-derived | "1 in X" at launch |
| currentOdds{Any,Top,Major,Profit}OneIn | estimate | "1 in X" per remaining ticket |
| topRetention / majorRetention / valueRetention | estimate | % remaining ÷ % tickets remaining |
| prizeToTicketRatio | official | remaining prize value ÷ price |
| tiers[] | mixed | per tier: counts, % remaining, value, odds now (estimate) / at launch, isTop, isMajor |
| warnings[] | — | data issues and implausible-EV warnings |
| score | — | `{score, label, rank, rankInPrice, peersInPrice, components[{key, raw, percentile, weight, effectiveWeight, contribution}], capped, notes}` |
| explanation | — | `{headline, emoji, strengths[], weaknesses[], avoidReasons[]}` |
