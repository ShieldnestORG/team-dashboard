-- 0155_university_member_timezone.sql
-- Coherent Ones University — store each member's IANA timezone so live-session
-- emails can show the wall-clock time in the member's OWN zone instead of the
-- storefront house zone.
--
-- Captured from the member's browser (Intl.DateTimeFormat().resolvedOptions()
-- .timeZone) when they RSVP to a session, and persisted here. The session-email
-- send sites (rsvp-confirm, waitlist-open, 24h/1h reminders, announce, cancel)
-- read it and pass it to the storefront renderer as data.timeZone; the renderer
-- falls back to the house zone (America/New_York) when it is NULL.
--
-- NULL for every member predating capture — that's expected, they ride the
-- house-zone fallback until their next RSVP. Display-only: NEVER billing, auth,
-- or entitlement. Free-text IANA id; validated in the app before write.
--
-- Forward-only, hand-written (never drizzle-kit generate); ADD COLUMN IF NOT
-- EXISTS is idempotent, so a re-run is a no-op.

ALTER TABLE university_members
  ADD COLUMN IF NOT EXISTS timezone text;
