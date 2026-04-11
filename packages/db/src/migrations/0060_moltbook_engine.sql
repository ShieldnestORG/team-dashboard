-- Moltbook autonomous engine tables
-- Feed ingestion with BGE-M3 embeddings, content log, daily stats

CREATE TABLE IF NOT EXISTS moltbook_feed (
  id SERIAL PRIMARY KEY,
  post_id TEXT NOT NULL UNIQUE,
  submolt TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  author_name TEXT NOT NULL,
  author_karma INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  embedding vector(1024),
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  engaged BOOLEAN DEFAULT FALSE,
  engagement_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_moltbook_feed_post ON moltbook_feed(post_id);
CREATE INDEX IF NOT EXISTS idx_moltbook_feed_ingested ON moltbook_feed(ingested_at);

CREATE TABLE IF NOT EXISTS moltbook_posts (
  id SERIAL PRIMARY KEY,
  moltbook_post_id TEXT,
  submolt TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  parent_post_id TEXT,
  generated_by TEXT DEFAULT 'ollama',
  prompt_context TEXT,
  embedding vector(1024),
  status TEXT DEFAULT 'posted',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moltbook_stats (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  posts_made INTEGER DEFAULT 0,
  comments_made INTEGER DEFAULT 0,
  upvotes_given INTEGER DEFAULT 0,
  feed_items_ingested INTEGER DEFAULT 0,
  ollama_calls INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0
);
