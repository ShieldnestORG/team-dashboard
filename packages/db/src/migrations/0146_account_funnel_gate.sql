-- 0146_account_funnel_gate.sql
-- Funnel-control kill-switch: a per-account gate that decides whether an account
-- is allowed to run IG DM/comment funnels at all. This is the account-level
-- guard the funnel-control feature checks BEFORE creating or re-activating any
-- Zernio comment automation. Default OFF so a newly onboarded account (e.g. the
-- girls not yet live) cannot start DMing until an admin explicitly enables it.
--
-- NOTE: this flag lives in team-dashboard only — it does NOT stop Zernio's own
-- DM engine on its own. It is an authorization gate on the CREATE/re-activate
-- paths; the actual DM kill is a DELETE/PATCH on Zernio's API. (See
-- server/src/services/platform-publishers/zernio.ts setZernioCommentAutomationActive.)
--
-- Hand-written in the repo's forward-only convention (no drizzle journal/snapshot),
-- next free slot after 0145. Additive only; `IF NOT EXISTS` keeps it a safe no-op
-- on any environment that already has the column.

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS funnels_enabled boolean NOT NULL DEFAULT false;

-- Backfill: accounts that already have at least one LIVE (is_active=true) mirrored
-- comment automation are clearly running funnels today — leave them ON so this
-- migration never silently kills a live funnel. Everything else stays OFF.
UPDATE social_accounts
SET funnels_enabled = true
WHERE funnels_enabled = false
  AND zernio_account_id IN (
    SELECT DISTINCT zernio_account_id
    FROM zernio_comment_automations
    WHERE is_active = true
      AND zernio_account_id IS NOT NULL
  );
