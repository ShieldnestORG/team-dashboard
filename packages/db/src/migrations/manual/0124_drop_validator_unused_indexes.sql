-- Run manually on production (Neon). Safe pre- or post-deploy.
--
-- validator_rank_history is WRITE-ONLY: rows are inserted by
-- server/src/services/cosmos-lcd.ts and read by NO query anywhere in the
-- codebase. Both secondary indexes had 0 lifetime scans (verified via
-- pg_stat_user_indexes) and only added overhead to every insert. The primary
-- key is kept. Indexes also removed from the Drizzle schema the same day.
--
-- Hand-written (not via drizzle-kit generate) because the drizzle snapshot has
-- drifted in this repo — `generate` emits a full CREATE-everything migration.
--
--   psql "$DATABASE_URL" -f packages/db/src/migrations/manual/0124_drop_validator_unused_indexes.sql

DROP INDEX IF EXISTS idx_validator_rank_history_lookup;
DROP INDEX IF EXISTS idx_validator_rank_history_network_time;
