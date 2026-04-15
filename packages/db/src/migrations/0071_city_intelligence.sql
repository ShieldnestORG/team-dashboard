-- City Intelligence — collected local-area signals per city.
-- Populated by the city-collector service (Firecrawl + Google Trends + Bing News
-- + Reddit + Yelp → Ollama merge into three ranked top-50 buckets).
--
-- Consumers:
--   - server/src/services/partner-content.ts — enriches generated posts with
--     real local signals when the partner has a matching location.
--   - server/src/routes/cities.ts — pitch generator for manual sales use.
--   - directory-matches endpoint — surfaces indexed projects in a region.

CREATE TABLE IF NOT EXISTS city_intelligence (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                UUID NOT NULL REFERENCES companies(id),
  slug                      TEXT NOT NULL,
  city                      TEXT NOT NULL,
  region                    TEXT,
  country                   TEXT NOT NULL DEFAULT 'US',
  population                INT,
  top_searches              JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_demand            JSONB NOT NULL DEFAULT '[]'::jsonb,
  trending_topics           JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_sources               JSONB NOT NULL DEFAULT '[]'::jsonb,
  collected_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  fresh_until               TIMESTAMPTZ,
  collection_duration_ms    INT,
  collection_status         TEXT NOT NULL DEFAULT 'pending',
  collection_error          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS city_intelligence_company_slug_idx
  ON city_intelligence (company_id, slug);

CREATE INDEX IF NOT EXISTS city_intelligence_collected_at_idx
  ON city_intelligence (collected_at DESC);
