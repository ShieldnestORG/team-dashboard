-- 0149_funnels.sql
-- Funnel Library (BUILD PHASE 2): a standing library of comment->DM funnel
-- drafts per Zernio-capable account. Goal: every funnels-capable account
-- keeps >=5 funnels "ready to go" (approved, not yet live) at all times — the
-- daily socials:funnel-topup cron (server/src/services/social-crons.ts) drafts
-- via AI, an admin approves/rejects, and "arm" is the one-click action that
-- creates the real Zernio comment automation (see createZernioCommentAutomation
-- in server/src/services/platform-publishers/zernio.ts) and flips the row live.
--
-- Seeded (lazily, on first read — see ensureFunnelCatalogImported in
-- server/src/services/socials/funnels-service.ts) from the checked-in
-- funnel-catalog.json snapshot via catalog_id, so the existing strategy
-- catalog and the new working table share one status vocabulary going
-- forward. catalog_id is nullable+unique: AI-drafted and admin-authored rows
-- have no catalog entry and leave it NULL (a UNIQUE index permits many NULLs
-- in Postgres, so this does not collide).
--
-- Status lifecycle: draft -> ready (admin approve) -> live (admin arm, creates
-- the Zernio automation) -> retired (admin retire, deletes the Zernio
-- automation). draft/ready can also go -> rejected (admin reject). See the
-- guard functions (canApprove/canReject/canArm/canRetire) in
-- funnels-service.ts for the enforced transitions.
--
-- Hand-written in the repo's forward-only convention (no drizzle journal/snapshot),
-- next free slot after 0148. Additive only; `IF NOT EXISTS` keeps it a safe
-- no-op on any environment that already has the table.

CREATE TABLE IF NOT EXISTS funnels (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id             UUID        NOT NULL REFERENCES companies(id),
  -- Stable id of the funnel-catalog.json entry this row was seeded from, or
  -- NULL for AI-drafted / admin-authored rows. Unique so re-running the
  -- import is a no-op upsert, never a duplicate.
  catalog_id             TEXT,
  name                   TEXT        NOT NULL,
  -- "@handle" (no leading @) this funnel targets. Best-effort for
  -- multi-account catalog entries (e.g. "all brand") — see the import mapper.
  account_handle         TEXT        NOT NULL,
  -- FK-style pointer, resolved by handle lookup at insert/generate time.
  -- Nullable: the target account may not exist yet, or the catalog entry may
  -- not map cleanly to one social_accounts row.
  social_account_id      UUID        REFERENCES social_accounts(id) ON DELETE SET NULL,
  keywords               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 'exact' | 'contains' — mirrors zernio_comment_automations.match_mode.
  match_mode             TEXT        NOT NULL DEFAULT 'contains',
  dm_message             TEXT        NOT NULL DEFAULT '',
  destination_url        TEXT,
  -- 3 caption hooks for posts that drive comments into this funnel.
  post_hooks             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 'standard' | 'controversial' | 'weird' — see funnels-service.ts STYLE_DEFS.
  style                  TEXT        NOT NULL DEFAULT 'standard',
  tos_risk                TEXT,
  notes                  TEXT,
  -- 'draft' | 'ready' | 'live' | 'rejected' | 'retired'
  status                 TEXT        NOT NULL DEFAULT 'draft',
  -- Board user id, or 'ai:<model>' for cron/generate-drafted rows.
  created_by             TEXT        NOT NULL DEFAULT 'system',
  approved_by_user_id    TEXT,
  -- Zernio's minted comment-automation id while status = 'live'.
  zernio_automation_id   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT funnels_status_ck CHECK (status IN ('draft', 'ready', 'live', 'rejected', 'retired')),
  CONSTRAINT funnels_style_ck CHECK (style IN ('standard', 'controversial', 'weird')),
  CONSTRAINT funnels_match_mode_ck CHECK (match_mode IN ('exact', 'contains'))
);

-- Plain (non-partial) unique index: Postgres unique indexes already treat
-- NULL as distinct-from-NULL, so AI-drafted/admin-authored rows (catalog_id
-- NULL) never collide with each other — no WHERE clause needed, which keeps
-- this compatible with drizzle-kit's typed onConflictDoNothing target.
CREATE UNIQUE INDEX IF NOT EXISTS funnels_catalog_id_uq
  ON funnels (catalog_id);

CREATE INDEX IF NOT EXISTS funnels_company_account_idx
  ON funnels (company_id, account_handle);

CREATE INDEX IF NOT EXISTS funnels_status_idx
  ON funnels (status);
