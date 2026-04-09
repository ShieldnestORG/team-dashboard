-- Drop Social Pulse tables (feature removed)
DROP TABLE IF EXISTS "pulse_xrpl_bridge_mentions";
DROP TABLE IF EXISTS "pulse_aggregations";
DROP TABLE IF EXISTS "pulse_tweets";

-- Drop related indexes (cascades with tables, but explicit for clarity)
DROP INDEX IF EXISTS "pulse_agg_period_topic_uq";
DROP INDEX IF EXISTS "pulse_tweets_tweet_id_uq";
DROP INDEX IF EXISTS "pulse_tweets_topic_idx";
DROP INDEX IF EXISTS "pulse_tweets_created_at_idx";
DROP INDEX IF EXISTS "pulse_tweets_author_idx";
DROP INDEX IF EXISTS "pulse_xrpl_bridge_type_idx";
DROP INDEX IF EXISTS "pulse_xrpl_bridge_captured_idx";
