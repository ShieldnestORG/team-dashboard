-- Validator rank history — time-series of validator standings per Cosmos chain.
-- Populated by intel:firecrawl-validators (scrapes public validator-list pages).
-- Used by content-crons to compute movement deltas ("ShieldNest moved up 2 ranks").

CREATE TABLE IF NOT EXISTS validator_rank_history (
  id            SERIAL PRIMARY KEY,
  network       TEXT NOT NULL,
  moniker       TEXT NOT NULL,
  rank          INT NOT NULL,
  voting_power  NUMERIC,
  commission    NUMERIC,
  uptime_pct    NUMERIC,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_validator_rank_history_lookup
  ON validator_rank_history (network, moniker, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_validator_rank_history_network_time
  ON validator_rank_history (network, captured_at DESC);
