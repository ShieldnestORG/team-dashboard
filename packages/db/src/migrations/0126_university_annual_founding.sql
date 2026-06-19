-- 0126_university_annual_founding.sql
-- Coherent Ones University — annual plan + FOUNDING-member price-lock.
--
-- Two product decisions land here (owner decision D9: "add both"):
--
--   1. ANNUAL PLAN. The membership now sells monthly ($50/mo) OR annual
--      ($500/yr — two months free). The `plan` column already exists on both
--      university_members and university_subscriptions (added in 0122,
--      defaulting to 'university_monthly'); annual checkouts simply write
--      plan='university_annual' onto those existing rows, so NO column change
--      is needed for the plan itself. It is captured here for the record.
--
--   2. FOUNDING-MEMBER PRICE-LOCK. The first N members (env UNIVERSITY_FOUNDING_CAP,
--      default 100) are "founding members": their rate is locked for life. We
--      record this as a durable boolean on the member entity rather than
--      re-deriving it from join order, because the cap is configurable and the
--      promise ("rate locked for life") must survive cap changes — once stamped
--      true, a member stays a founder forever. The webhook sets it true at
--      activation while COUNT(university_members) < cap.
--
-- Additive only: 1 new column + 1 partial index. The column has a NOT NULL
-- DEFAULT false so existing rows backfill to non-founding (correct: anyone who
-- joined before this shipped predates the founding offer's enforcement, and the
-- count-based stamp is applied going forward). Mirrors the 0122-0125
-- hand-written style. CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- everywhere. Safe to re-apply against prod.

-- ---------------------------------------------------------------------------
-- university_members.founding — the lifetime price-lock flag
-- ---------------------------------------------------------------------------
ALTER TABLE university_members
  ADD COLUMN IF NOT EXISTS founding BOOLEAN NOT NULL DEFAULT false;

-- Partial index over founders only — the set we count/report ("N founders
-- claimed, M remain") and the badge gate. Founders are a small bounded set, so
-- a partial index keeps it tiny and skips the false majority.
CREATE INDEX IF NOT EXISTS university_members_founding_idx
  ON university_members (founding)
  WHERE founding = true;
