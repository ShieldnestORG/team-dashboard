-- 0151: alert_events — persist every ops alert with severity routing.
-- "critical" alerts email immediately; "routine" alerts only land here and are
-- summarized by the Sunday alert:weekly-recap cron.
CREATE TABLE IF NOT EXISTS alert_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  type        TEXT        NOT NULL,
  severity    TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  email_sent  BOOLEAN     NOT NULL DEFAULT false,
  email_error TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alert_events_severity_ck CHECK (severity IN ('critical', 'routine'))
);

CREATE INDEX IF NOT EXISTS alert_events_created_idx ON alert_events (created_at);
CREATE INDEX IF NOT EXISTS alert_events_type_created_idx ON alert_events (type, created_at);

-- alert:digest cron retired (folded into alert:weekly-recap). The registry
-- sync only upserts, so the orphaned row must be removed here or it would
-- eventually flag as critically stale.
DELETE FROM system_crons WHERE job_name = 'alert:digest';
