-- Trends digest — the "what's hot" feed's persisted output, one row per run
-- date. A digest is born `pending` and is only served to members once a human
-- flips it to `approved` (Rule 7 of the hardened anti-hallucination method:
-- a shared bad/stale run hits every member at once, so an admin approves
-- before any blast). `payload` carries the full TrendDigest (items, stats,
-- saturation verdicts, provenance tags); `ad_friendly_ids` is the ✅-only
-- subset cleared for paid-ad copy (Rule 5).
CREATE TABLE IF NOT EXISTS trends_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','sent','rejected')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL,
  ad_friendly_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trends_digests_date_key
  ON trends_digests (digest_date);

CREATE INDEX IF NOT EXISTS trends_digests_status_idx
  ON trends_digests (status, digest_date DESC);
