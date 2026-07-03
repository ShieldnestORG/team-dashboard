-- 0122_zernio_engagement.sql
-- Zernio engagement layer: comment->DM->captured-lead loop + analytics storage.
-- Spec: marketing/plans/plan-zernio-leverage.md (§2 lead-loop, §1 levers L4/L6);
-- analytics tables per CONTROLLER-AUDIT-2026-06-21 Goal B.
--
-- NUMBERING NOTE: this is team-dashboard's OWN migration sequence continuing
-- after 0121_affiliate_clawbacks. The 0122-0137 numeric prefixes already in
-- this folder belong to the University app's parallel sequence — duplicate
-- numeric prefixes with distinct tags are the established convention here
-- (see the 0119_creditscore_audit_runs / 0119_watchtower_rank pair). The
-- journal tag for this file is 0122_zernio_engagement.
--
-- FIVE additions, all additive + idempotent (safe against prod):
--
--   1) social_accounts.zernio_account_id — first-class column for the Zernio
--      account id that today only lives embedded in oauth_ref as
--      "zernio:<id>" (Goal B: "BUILD: first-class column"). Backfilled from
--      oauth_ref; oauth_ref stays authoritative for publish routing.
--
--   2) zernio_webhook_events — at-least-once webhook inbox. Delivery is
--      deduped on the payload's stable event id (UNIQUE), per the L4
--      decision. Rows record processing outcome for the cockpit.
--
--   3) social_leads — the captured-lead layer (comment / DM reply / lead
--      form / clickTag'd contact). Brevo stays the nurture CRM: rows with an
--      email get synced by the lead relayer tick; rows without one remain
--      social-capture only (you cannot nurture an IGSID by email).
--
--   4) zernio_comment_automations — local mirror of the keyword funnels
--      (ROOM/COHERENT/...). Zernio is the source of truth; the mirror powers
--      the cockpit list + supplies the clickTag set the contacts poller scans.
--
--   5) zernio_analytics_snapshots + zernio_post_analytics — Goal B storage.
--      Snapshots hold whole endpoint responses per (metric, account, window);
--      post analytics are flattened per (external post, platform) and
--      correlated back to social_posts via platform_post_id / posted_url.
--      NEVER blend these with the X-engine's x_engagement_log numbers — they
--      measure different things (audit Area 4 risk note).
--
-- Style mirrors 0136: plain lowercase identifiers, IF NOT EXISTS on every
-- statement, CHECK for enums-by-convention, gen_random_uuid(), timestamptz.

-- 1) First-class Zernio account id on social_accounts (backfill from oauth_ref).
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT;

UPDATE social_accounts
   SET zernio_account_id = substring(oauth_ref from 8)
 WHERE oauth_ref LIKE 'zernio:%'
   AND zernio_account_id IS NULL;

CREATE INDEX IF NOT EXISTS social_accounts_zernio_account_idx
  ON social_accounts (zernio_account_id);

-- 2) Webhook inbox — dedup on Zernio's stable event id (at-least-once delivery).
CREATE TABLE IF NOT EXISTS zernio_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,                      -- payload.id (stable across redeliveries)
  event_type TEXT NOT NULL,                    -- payload.event, e.g. 'comment.received'
  zernio_account_id TEXT,                      -- payload.account.id when present
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full verified envelope
  processed_at TIMESTAMPTZ,                    -- NULL = stored but handler failed/skipped
  error TEXT,                                  -- handler error (delivery still 200s)
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS zernio_webhook_events_event_id_uq
  ON zernio_webhook_events (event_id);

CREATE INDEX IF NOT EXISTS zernio_webhook_events_type_received_idx
  ON zernio_webhook_events (event_type, received_at);

-- 3) Captured leads (the §2 loop's output). Brevo sync state lives here.
CREATE TABLE IF NOT EXISTS social_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'zernio',
  capture_kind TEXT NOT NULL
    CHECK (capture_kind IN ('comment', 'dm', 'lead_form', 'contact_tag')),
  platform TEXT,                               -- 'instagram' | 'facebook' | ...
  zernio_account_id TEXT,
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform_user_id TEXT,                       -- author/sender platform id (IGSID etc.)
  handle TEXT,
  display_name TEXT,
  email TEXT,                                  -- NULL until something captures one
  keyword TEXT,                                -- comment/DM text keyword hit (ROOM, COHERENT, ...)
  click_tag TEXT,                              -- clickTag that segmented this lead
  zernio_contact_id TEXT,                      -- Zernio CRM contact id when known
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- last raw capture detail
  event_count INTEGER NOT NULL DEFAULT 1,
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  brevo_synced_at TIMESTAMPTZ,                 -- NULL = not (yet) in Brevo
  brevo_attempts INTEGER NOT NULL DEFAULT 0,
  brevo_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One lead row per person per capture rail. Partial: webhook captures key on
-- the platform user id; contact-poll captures key on the Zernio contact id.
CREATE UNIQUE INDEX IF NOT EXISTS social_leads_platform_user_uq
  ON social_leads (source, platform, platform_user_id)
  WHERE platform_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_leads_contact_uq
  ON social_leads (zernio_contact_id)
  WHERE zernio_contact_id IS NOT NULL;

-- The lead relayer tick's scan: unsynced rows that actually have an email.
CREATE INDEX IF NOT EXISTS social_leads_brevo_pending_idx
  ON social_leads (created_at)
  WHERE brevo_synced_at IS NULL AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_leads_account_idx
  ON social_leads (zernio_account_id, last_event_at);

-- 4) Local mirror of Zernio comment automations (keyword funnels).
CREATE TABLE IF NOT EXISTS zernio_comment_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zernio_automation_id TEXT NOT NULL,
  zernio_account_id TEXT NOT NULL,
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  platform TEXT,
  trigger TEXT NOT NULL DEFAULT 'comment'
    CHECK (trigger IN ('comment', 'story_reply')),
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_mode TEXT NOT NULL DEFAULT 'contains'
    CHECK (match_mode IN ('exact', 'contains')),
  dm_message TEXT NOT NULL,
  buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment_reply TEXT,
  link_tracking BOOLEAN NOT NULL DEFAULT true,
  click_tag TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,    -- Zernio's stats block, as returned
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS zernio_comment_automations_zid_uq
  ON zernio_comment_automations (zernio_automation_id);

CREATE INDEX IF NOT EXISTS zernio_comment_automations_account_idx
  ON zernio_comment_automations (zernio_account_id);

-- 5a) Whole-endpoint analytics snapshots (daily-metrics, best-time, ...).
CREATE TABLE IF NOT EXISTS zernio_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric TEXT NOT NULL,                        -- endpoint key, e.g. 'daily-metrics'
  zernio_account_id TEXT,                      -- NULL = workspace-wide fetch
  platform TEXT,
  window_from TIMESTAMPTZ,
  window_to TIMESTAMPTZ,
  addon_missing BOOLEAN NOT NULL DEFAULT false, -- 402/403 recorded, not thrown away
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zernio_analytics_snapshots_lookup_idx
  ON zernio_analytics_snapshots (metric, zernio_account_id, fetched_at);

-- 5b) Per-post analytics, flattened per platform, correlated to social_posts.
-- The live DB may carry an ORPHANED pre-engagement zernio_post_analytics (created
-- outside this journal by the superseded x-accounts-optimize branch; verified empty
-- + referenced by no code on 2026-07-02). Its presence makes the CREATE TABLE below
-- a no-op and the external_post_id index fail — supersede it, but refuse if data
-- has appeared since the check.
DO $$
BEGIN
  IF to_regclass('public.zernio_post_analytics') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'zernio_post_analytics'
         AND column_name = 'external_post_id'
     ) THEN
    IF EXISTS (SELECT 1 FROM public.zernio_post_analytics LIMIT 1) THEN
      RAISE EXCEPTION 'zernio_post_analytics has the pre-0122 shape AND rows — reconcile manually before applying 0122';
    END IF;
    DROP TABLE public.zernio_post_analytics;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS zernio_post_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_post_id TEXT NOT NULL,              -- analytics list `_id`
  zernio_post_id TEXT,                         -- `latePostId` when scheduled via Zernio
  zernio_account_id TEXT,
  platform TEXT NOT NULL,
  platform_post_id TEXT,                       -- native post id (correlation key)
  platform_post_url TEXT,
  social_post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  content TEXT,
  published_at TIMESTAMPTZ,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,  -- PostAnalytics block, as returned
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS zernio_post_analytics_ext_uq
  ON zernio_post_analytics (external_post_id, platform);

CREATE INDEX IF NOT EXISTS zernio_post_analytics_account_idx
  ON zernio_post_analytics (zernio_account_id, published_at);
