-- 0143_university_email_events.sql
-- Coherent Ones University — email-campaign analytics (opens / clicks / bounces).
--
-- Two additive pieces:
--
--   1. university_email_log.message_id — the ESP (Brevo) messageId returned by
--      the storefront's POST /api/email/creditscore (202 { accepted, id }).
--      Captured at send time by the crons that log sends (reengage series +
--      streak nudge), so engagement events can be joined back to the exact
--      send. Nullable: the storefront may respond without an id (template
--      owner-gated, suppression hit, older storefront build).
--
--   2. university_email_events — one row per Brevo engagement event
--      (delivered / opened / clicked / bounced / spam / unsubscribed /
--      blocked / other), forwarded by the storefront to
--      POST /api/university/email-events (HMAC-signed, EMAIL_EVENTS_KEY).
--      `kind` is the campaign kind extracted from the first Brevo tag
--      starting with 'university_' (nullable — untagged sends still record).
--      `occurred_at` is Brevo's event timestamp; `received_at` is ours.
--
-- Dedupe: Brevo webhooks retry, and the storefront forwards each attempt. The
-- UNIQUE index on (message_id, event, occurred_at) makes exact repeats no-ops
-- via ON CONFLICT DO NOTHING. NULL message_ids never collide (Postgres treats
-- NULLs as distinct), so id-less events are always kept — correct, since we
-- can't prove two of them are the same event.
--
-- Indexes: the dedupe UNIQUE index leads on message_id, so it doubles as the
-- per-message lookup index (no separate (message_id) index needed). The
-- (kind, event) index serves the stats rollup's GROUP BY scans.
--
-- Additive only: 1 column + 1 table + 2 indexes. Safe to apply against prod.

ALTER TABLE university_email_log
  ADD COLUMN IF NOT EXISTS message_id TEXT;

CREATE TABLE IF NOT EXISTS university_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,                                   -- ESP messageId (joins to university_email_log.message_id)
  email TEXT NOT NULL,                               -- lowercased recipient (durable join key)
  kind TEXT,                                         -- campaign kind from the first 'university_*' tag, else NULL
  event TEXT NOT NULL,                               -- delivered|opened|clicked|bounced|spam|unsubscribed|blocked|other
  url TEXT,                                          -- clicked link (clicked events only)
  occurred_at TIMESTAMPTZ NOT NULL,                  -- ESP event time
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()     -- when we stored it
);

-- Exact-repeat dedupe (webhook retries). Leading message_id column also serves
-- the per-message lookup, replacing a separate (message_id) index.
CREATE UNIQUE INDEX IF NOT EXISTS university_email_events_dedupe_uq
  ON university_email_events (message_id, event, occurred_at);

-- Stats rollup: "per kind, distinct emails per event".
CREATE INDEX IF NOT EXISTS university_email_events_kind_event_idx
  ON university_email_events (kind, event);
