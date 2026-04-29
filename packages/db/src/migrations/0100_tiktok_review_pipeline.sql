-- 0100_tiktok_review_pipeline.sql
-- TikTok Review Pipeline — backing tables for Rizz, the AI TikTok content reviewer.
--
-- Two tables:
--   tiktok_review_submissions — queue of submitted @-handles awaiting review.
--                                Gated on consent form lifecycle (form_status).
--                                Pipeline lifecycle (pipeline_status) only progresses
--                                while form_status = 'countersigned'.
--   tiktok_audits             — result of scraping a submitted @'s public profile.
--                                Hook timings, caption lengths, posting cadence,
--                                receipt video IDs, raw scraper payload.
--
-- Additive only: two tables + seven indexes. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS tiktok_review_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  brand TEXT NOT NULL DEFAULT 'rizz',

  -- Submitter identity
  submitter_email TEXT NOT NULL,
  submitter_handle TEXT NOT NULL,
  additional_handles JSONB,
  country_of_residence TEXT,
  date_of_birth TEXT,

  -- Consent form gate
  form_id TEXT NOT NULL,
  -- 'pending_verification' | 'verified' | 'countersigned' | 'rejected' | 'withdrawn'
  form_status TEXT NOT NULL DEFAULT 'pending_verification',
  consent_verified_at TIMESTAMPTZ,
  countersigned_at TIMESTAMPTZ,

  -- Pipeline state
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'queued' | 'scraping' | 'drafting' | 'gated' | 'approved' | 'rendering'
  --   | 'published' | 'takedown_requested' | 'takedown_completed'
  pipeline_status TEXT NOT NULL DEFAULT 'queued',

  takedown_requested_at TIMESTAMPTZ,

  -- Published-URL tracking
  published_tiktok_url TEXT,
  published_ig_url TEXT,
  published_youtube_url TEXT,

  -- Owner-only notes (not exposed to submitter)
  notes_internal TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tiktok_review_submissions_company_queued_idx
  ON tiktok_review_submissions(company_id, queued_at);
CREATE INDEX IF NOT EXISTS tiktok_review_submissions_company_form_status_idx
  ON tiktok_review_submissions(company_id, form_status);
CREATE INDEX IF NOT EXISTS tiktok_review_submissions_company_pipeline_status_idx
  ON tiktok_review_submissions(company_id, pipeline_status);
CREATE INDEX IF NOT EXISTS tiktok_review_submissions_form_id_idx
  ON tiktok_review_submissions(form_id);

CREATE TABLE IF NOT EXISTS tiktok_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES tiktok_review_submissions(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),

  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Structured snapshot
  profile_snapshot JSONB NOT NULL,
  recent_videos JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Pattern-extraction results
  hook_timings JSONB NOT NULL DEFAULT '[]'::jsonb,
  caption_lengths JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Numeric scores (0..1 unless noted)
  bio_specificity_score NUMERIC(3,2),
  posting_cadence_videos_per_week NUMERIC(5,2),
  posting_cadence_consistency NUMERIC(3,2),
  repeat_hook_rate NUMERIC(3,2),

  -- The 3 video IDs Rizz cites as receipts in the draft script
  top3_receipt_video_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Full unstructured payload from the scraper (kept for re-derivation)
  raw_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tiktok_audits_submission_idx ON tiktok_audits(submission_id);
CREATE INDEX IF NOT EXISTS tiktok_audits_company_idx ON tiktok_audits(company_id);
CREATE INDEX IF NOT EXISTS tiktok_audits_captured_at_idx ON tiktok_audits(captured_at);
