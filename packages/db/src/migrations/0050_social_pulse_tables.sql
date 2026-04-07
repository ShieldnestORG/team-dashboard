-- Social Pulse TX tables for real-time X/Twitter intelligence

CREATE TABLE IF NOT EXISTS pulse_tweets (
  id SERIAL PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_username TEXT NOT NULL,
  author_name TEXT,
  text TEXT NOT NULL,
  tweet_created_at TIMESTAMPTZ NOT NULL,
  topic TEXT NOT NULL,
  sentiment_score REAL,
  metrics_likes INTEGER NOT NULL DEFAULT 0,
  metrics_retweets INTEGER NOT NULL DEFAULT 0,
  metrics_replies INTEGER NOT NULL DEFAULT 0,
  metrics_impressions INTEGER NOT NULL DEFAULT 0,
  source_query TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pulse_tweets_tweet_id_uq ON pulse_tweets (tweet_id);
CREATE INDEX IF NOT EXISTS pulse_tweets_topic_idx ON pulse_tweets (topic);
CREATE INDEX IF NOT EXISTS pulse_tweets_created_at_idx ON pulse_tweets (tweet_created_at);
CREATE INDEX IF NOT EXISTS pulse_tweets_author_idx ON pulse_tweets (author_username);

CREATE TABLE IF NOT EXISTS pulse_aggregations (
  id SERIAL PRIMARY KEY,
  period TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  topic TEXT NOT NULL,
  tweet_count INTEGER NOT NULL DEFAULT 0,
  avg_sentiment REAL,
  total_likes INTEGER NOT NULL DEFAULT 0,
  total_retweets INTEGER NOT NULL DEFAULT 0,
  total_impressions INTEGER NOT NULL DEFAULT 0,
  top_tweet_id TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pulse_agg_period_topic_uq ON pulse_aggregations (period, period_start, topic);

CREATE TABLE IF NOT EXISTS pulse_xrpl_bridge_mentions (
  id SERIAL PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  bridge_type TEXT NOT NULL,
  token_mentioned TEXT NOT NULL,
  staking_mentioned BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pulse_xrpl_bridge_type_idx ON pulse_xrpl_bridge_mentions (bridge_type);
CREATE INDEX IF NOT EXISTS pulse_xrpl_bridge_captured_idx ON pulse_xrpl_bridge_mentions (captured_at);
