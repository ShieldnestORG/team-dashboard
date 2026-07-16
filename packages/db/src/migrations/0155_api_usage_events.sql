-- 0155: api_usage_events — success-path API usage/cost meter (Phase 2 of the
-- provider observability work; Phase 1 was PR #172's failure alerts). One row
-- per successful provider call: token counts always faithful, cost_usd only
-- non-zero where the model's price is verified (see server api-usage service).
-- The community agents are NOT recorded here — they keep their own ledger
-- (university_agent_usage) and double-counting would inflate spend.
CREATE TABLE IF NOT EXISTS api_usage_events (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  provider      TEXT          NOT NULL,
  service       TEXT          NOT NULL,
  model         TEXT          NOT NULL,
  input_tokens  INTEGER       NOT NULL DEFAULT 0,
  output_tokens INTEGER       NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_usage_events_created_idx ON api_usage_events (created_at);
CREATE INDEX IF NOT EXISTS api_usage_events_provider_created_idx ON api_usage_events (provider, created_at);
