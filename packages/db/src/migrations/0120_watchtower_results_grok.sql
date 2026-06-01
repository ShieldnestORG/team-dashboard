-- 0120_watchtower_results_grok.sql
-- Adds 'grok' to the watchtower_results.engine CHECK constraint.
--
-- Grok was added as the 5th engine adapter (ALL_ENGINES in
-- watchtower-engines/index.ts) but the engine CHECK constraint — created in
-- 0109 with only chatgpt/claude/perplexity/gemini — was never updated. Every
-- run includes a grok result row (the engine is always queried, even when its
-- API errors), so every run violated the constraint and the whole insert
-- transaction rolled back. That is why no watchtower run had ever persisted.
--
-- Idempotent: drop-if-exists then recreate with the full five-engine set.

ALTER TABLE watchtower_results
  DROP CONSTRAINT IF EXISTS watchtower_results_engine_check;

ALTER TABLE watchtower_results
  ADD CONSTRAINT watchtower_results_engine_check
  CHECK (engine = ANY (ARRAY['chatgpt'::text, 'claude'::text, 'perplexity'::text, 'gemini'::text, 'grok'::text]));
