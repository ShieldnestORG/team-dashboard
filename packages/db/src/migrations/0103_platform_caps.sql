-- Per-platform daily caps for content generation + publishing.
-- Read by server/src/services/socials/platform-caps.ts and enforced by
-- content-crons.ts (canGenerate) and social-relayer.ts (canPublish).

CREATE TABLE IF NOT EXISTS platform_caps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL UNIQUE,
  max_generated_per_day INT NOT NULL,
  max_published_per_day INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_caps (platform, max_generated_per_day, max_published_per_day)
VALUES
  ('bluesky',   5, 5),
  ('x',        10, 10),
  ('reddit',    2, 2),
  ('linkedin',  2, 2),
  ('discord',   6, 6),
  ('instagram', 3, 3)
ON CONFLICT (platform) DO NOTHING;
