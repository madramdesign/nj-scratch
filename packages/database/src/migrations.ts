/**
 * Forward-only migrations. Never edit a migration that has shipped; add a new one.
 * Historical tables are append-only: nothing in the app UPDATEs or DELETEs snapshot rows.
 */
export const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE data_sources (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  is_official INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE update_runs (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES data_sources(id),
  trigger TEXT NOT NULL,                 -- scheduled | manual | cli | backfill
  started_at INTEGER NOT NULL,           -- epoch ms
  finished_at INTEGER,
  observed_at INTEGER NOT NULL,          -- when the data is "as of" (fetch time, or archive capture time)
  status TEXT NOT NULL,                  -- running | success | unchanged | stale | failed
  http_status INTEGER,
  payload_hash TEXT,
  games_total INTEGER,
  games_active INTEGER,
  games_rankable INTEGER,
  games_invalid INTEGER,
  issues_json TEXT,
  error TEXT,
  duration_ms INTEGER
);
CREATE INDEX idx_runs_status_observed ON update_runs(status, observed_at);
CREATE INDEX idx_runs_started ON update_runs(started_at);

CREATE TABLE raw_payloads (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES update_runs(id),
  payload_hash TEXT NOT NULL UNIQUE,
  fetched_at INTEGER NOT NULL,
  body_gzip BLOB NOT NULL
);

CREATE TABLE games (
  game_id TEXT PRIMARY KEY,
  game_number TEXT NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  launch_date INTEGER,
  disable_date INTEGER,
  total_tickets_printed INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_games_price ON games(price_cents);

-- Current prize structure (static per game; changes are recorded as change_events).
CREATE TABLE prize_tiers (
  game_id TEXT NOT NULL REFERENCES games(game_id),
  tier_number INTEGER NOT NULL,
  prize_cents INTEGER NOT NULL,
  advertised_cents INTEGER,
  description TEXT NOT NULL,
  tier_type INTEGER NOT NULL,
  original_count INTEGER NOT NULL,
  PRIMARY KEY (game_id, tier_number)
);

CREATE TABLE game_snapshots (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES update_runs(id),
  game_id TEXT NOT NULL REFERENCES games(game_id),
  observed_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  launch_date INTEGER,
  start_distribution_date INTEGER,
  end_distribution_date INTEGER,
  disable_date INTEGER,
  total_tickets_printed INTEGER,
  top_prize_cents INTEGER,
  top_prize_label TEXT,
  data_hash TEXT NOT NULL,
  UNIQUE (run_id, game_id)
);
CREATE INDEX idx_game_snapshots_game_time ON game_snapshots(game_id, observed_at);
CREATE INDEX idx_game_snapshots_run ON game_snapshots(run_id);

CREATE TABLE prize_snapshots (
  snapshot_id INTEGER NOT NULL REFERENCES game_snapshots(id),
  tier_number INTEGER NOT NULL,
  original_tier_number INTEGER,
  prize_cents INTEGER NOT NULL,
  description TEXT,
  tier_type INTEGER NOT NULL,
  original_count INTEGER NOT NULL,
  paid_count INTEGER NOT NULL,
  claimed_count INTEGER NOT NULL,
  remaining_count INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, tier_number)
);

-- Score and key metrics computed at ingest time with DEFAULT weights, for history charts.
CREATE TABLE scoring_snapshots (
  snapshot_id INTEGER PRIMARY KEY REFERENCES game_snapshots(id),
  run_id INTEGER NOT NULL REFERENCES update_runs(id),
  game_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  methodology_version INTEGER NOT NULL,
  score REAL,
  rank INTEGER,
  label TEXT,
  current_ev_cents REAL,
  current_return REAL,
  original_return REAL,
  top_remaining INTEGER,
  top_original INTEGER,
  major_remaining INTEGER,
  major_original INTEGER,
  prizes_remaining INTEGER,
  value_remaining_cents INTEGER,
  tickets_remaining_est INTEGER,
  components_json TEXT
);
CREATE INDEX idx_scoring_game_time ON scoring_snapshots(game_id, observed_at);

CREATE TABLE change_events (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES update_runs(id),
  game_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  tier_number INTEGER,
  delta REAL
);
CREATE INDEX idx_events_time ON change_events(observed_at);
CREATE INDEX idx_events_game ON change_events(game_id, observed_at);

CREATE TABLE watchlist (
  game_id TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL,
  score_at_add REAL,
  note TEXT
);
`,
  },
];
