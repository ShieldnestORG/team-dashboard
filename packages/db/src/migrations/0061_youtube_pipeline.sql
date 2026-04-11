-- YouTube Pipeline tables
-- Migration: 0061_youtube_pipeline.sql

CREATE TABLE IF NOT EXISTS yt_content_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  topic TEXT NOT NULL,
  angle TEXT NOT NULL,
  pillar TEXT NOT NULL DEFAULT 'crypto',
  content_type TEXT NOT NULL DEFAULT 'Explainer',
  target_audience TEXT,
  keywords JSONB DEFAULT '[]',
  estimated_views INTEGER,
  best_publish_time TIMESTAMPTZ,
  competitor_analysis JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS yt_strategies_company_pillar_idx ON yt_content_strategies(company_id, pillar);
CREATE INDEX IF NOT EXISTS yt_strategies_created_idx ON yt_content_strategies(created_at);

CREATE TABLE IF NOT EXISTS yt_seo_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  content_item_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  tags JSONB DEFAULT '[]',
  hashtags JSONB DEFAULT '[]',
  chapters JSONB,
  end_screen JSONB,
  seo_score INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS yt_seo_content_item_idx ON yt_seo_data(content_item_id);
CREATE INDEX IF NOT EXISTS yt_seo_company_idx ON yt_seo_data(company_id);

CREATE TABLE IF NOT EXISTS yt_productions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  strategy_id UUID REFERENCES yt_content_strategies(id),
  content_item_id TEXT,
  seo_id UUID REFERENCES yt_seo_data(id),
  status TEXT NOT NULL DEFAULT 'pending',
  visual_mode TEXT NOT NULL DEFAULT 'presentation',
  priority INTEGER DEFAULT 50,
  estimated_duration TEXT,
  assets JSONB,
  timeline JSONB,
  scheduled_publish_time TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS yt_productions_company_status_idx ON yt_productions(company_id, status);
CREATE INDEX IF NOT EXISTS yt_productions_created_idx ON yt_productions(created_at);

CREATE TABLE IF NOT EXISTS yt_publish_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  production_id UUID NOT NULL REFERENCES yt_productions(id),
  title TEXT NOT NULL,
  publish_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  priority INTEGER DEFAULT 50,
  youtube_video_id TEXT,
  youtube_url TEXT,
  published_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS yt_publish_queue_company_status_idx ON yt_publish_queue(company_id, status);
CREATE INDEX IF NOT EXISTS yt_publish_queue_publish_time_idx ON yt_publish_queue(publish_time);

CREATE TABLE IF NOT EXISTS yt_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  youtube_video_id TEXT NOT NULL,
  video_title TEXT,
  analytics_data JSONB,
  thumbnail_metrics JSONB,
  seo_metrics JSONB,
  insights JSONB,
  performance_score INTEGER,
  performance_grade TEXT,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS yt_analytics_video_idx ON yt_analytics(company_id, youtube_video_id);
CREATE INDEX IF NOT EXISTS yt_analytics_analyzed_idx ON yt_analytics(analyzed_at);

CREATE TABLE IF NOT EXISTS yt_keyword_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  keyword TEXT NOT NULL,
  total_uses INTEGER NOT NULL DEFAULT 0,
  total_views INTEGER NOT NULL DEFAULT 0,
  average_views REAL DEFAULT 0,
  best_video_id TEXT,
  performance_score REAL DEFAULT 0,
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS yt_keyword_perf_company_keyword_uq ON yt_keyword_performance(company_id, keyword);
CREATE INDEX IF NOT EXISTS yt_keyword_perf_score_idx ON yt_keyword_performance(performance_score);
