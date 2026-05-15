-- 0113_admin_access_log.sql
-- Admin access log — ops-telemetry audit trail for authenticated admin
-- route hits. Stream D blocker / V2 blocker #6 from
-- docs/audits/watchtower-portal-audit-2026-05-13.md.
--
-- Two-table split (deliberate, documented here so future contributors don't
-- collapse them):
--
--   activity_log         (existing) — COMPLIANCE.
--     Customer-visible (surfaced in GDPR data export), retained
--     indefinitely, written only for business-material events
--     (subscription created/changed/cancelled, impersonation start/end,
--     refunds, etc.). Touched by domain services, NOT by middleware.
--
--   admin_access_log     (this table) — OPS TELEMETRY.
--     Admin-internal, NOT in customer GDPR export, 90-day retention,
--     written by route middleware on every authenticated admin hit.
--     Includes unauthenticated 401s (worth knowing about). Designed for
--     forensic "who touched admin route X in the last hour" queries, not
--     for compliance reporting.
--
-- 90-day retention cron is OUT OF SCOPE for this migration; see TODO in
-- server/src/middleware/log-admin-access.ts.
--
-- `actor_id` is intentionally nullable + untyped — we log unauth attempts
-- (status 401, actor_type='none') and the existing actor union mixes UUID
-- user ids with non-UUID synthetic ids ('local-board'), so a UUID column
-- with no FK is the right shape today.
--
-- Additive only. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS admin_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        UUID,
  actor_type      TEXT,
  actor_label     TEXT,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  status_code     INTEGER NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  request_summary JSONB,
  duration_ms     INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_access_log_actor_idx
  ON admin_access_log (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_access_log_path_idx
  ON admin_access_log (path, created_at DESC);
