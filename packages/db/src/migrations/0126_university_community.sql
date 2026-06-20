-- 0126_university_community.sql
-- Coherent Ones University — native COMMUNITY feed. The "Do, between sessions"
-- beat of the Coherent Loop: a members-only async feed where members post short
-- updates, comment on each other, and react ("Resonate") between live sessions.
--
-- Five tables, all additive:
--   - university_community_posts          — top-level posts (the feed)
--   - university_community_comments       — replies on a post (the thread)
--   - university_community_reactions      — one "Resonate" per member per target
--   - university_community_reports        — the moderation queue (report → auto-hide)
--   - university_community_notifications  — in-app "someone replied to you" rows
--
-- The member is identified the same way the rest of University is — by the
-- shared customer_accounts login (account_id once the linker has fired) joined
-- on the lowercased `email` as the durable author key. Both are stored on each
-- row so attribution holds before AND after the account link resolves. The
-- author display name is resolved at read time from university_members.
--
-- Moderation is light + owner-run: a member report bumps an open-report count;
-- at the auto-hide threshold (env COMMUNITY_AUTOHIDE_REPORTS, default 2) the
-- target flips to status='hidden' (reversible) pending Mark's review. Bodies are
-- plain text, length-capped + profanity-gated in the service. comment_count /
-- reaction_count are denormalized for the feed and maintained in the same
-- transaction as the write that changes them; the rows remain the source of
-- truth (a trivial recompute fixes any drift). Reactions are the one place rows
-- are deleted (a withdrawn reaction carries no audit value); posts/comments are
-- soft-deleted (status='removed', kept for audit, never rendered).
--
-- Mirrors the 0123/0124/0125 table/index style. Additive only: 5 tables +
-- indexes (several unique for idempotency). Safe to apply against prod.

-- Top-level posts — the feed.
CREATE TABLE IF NOT EXISTS university_community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  author_email TEXT NOT NULL,                        -- lowercased durable author key
  body TEXT NOT NULL,                                -- plain text; length-capped + profanity-gated in service
  comment_count INTEGER NOT NULL DEFAULT 0,          -- denormalized; maintained in the comment write txn
  reaction_count INTEGER NOT NULL DEFAULT 0,         -- denormalized; maintained on react/unreact
  status TEXT NOT NULL DEFAULT 'visible',            -- visible | hidden | removed
  hidden_reason TEXT,                                -- set when status != visible: report | profanity | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The feed query: visible posts, newest first (cursor pagination rides this).
CREATE INDEX IF NOT EXISTS university_community_posts_feed_idx
  ON university_community_posts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS university_community_posts_author_idx
  ON university_community_posts (author_email);

CREATE INDEX IF NOT EXISTS university_community_posts_account_idx
  ON university_community_posts (account_id);

-- Replies on a post — the thread.
CREATE TABLE IF NOT EXISTS university_community_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES university_community_posts(id),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  author_email TEXT NOT NULL,                        -- lowercased durable author key
  body TEXT NOT NULL,                                -- plain text; length-capped + profanity-gated in service
  status TEXT NOT NULL DEFAULT 'visible',            -- visible | hidden | removed
  hidden_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thread render: a post's visible comments, oldest first.
CREATE INDEX IF NOT EXISTS university_community_comments_thread_idx
  ON university_community_comments (post_id, status, created_at);

CREATE INDEX IF NOT EXISTS university_community_comments_author_idx
  ON university_community_comments (author_email);

CREATE INDEX IF NOT EXISTS university_community_comments_account_idx
  ON university_community_comments (account_id);

-- One reaction per member per target per emoji. The target is polymorphic
-- (post | comment), so there is no FK on target_id — integrity is enforced in
-- the service (verify the target exists + is visible before insert).
CREATE TABLE IF NOT EXISTS university_community_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  reactor_email TEXT NOT NULL,                       -- lowercased durable reactor key
  target_type TEXT NOT NULL,                         -- 'post' | 'comment'
  target_id UUID NOT NULL,                           -- post or comment id (polymorphic; no FK)
  emoji TEXT NOT NULL DEFAULT 'resonate',            -- MVP single kind; column accommodates a v2 palette
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: one reaction per member+target+emoji. A double-tap is a no-op
-- (ON CONFLICT DO NOTHING in the service), not an error. Keyed on the durable
-- email identity so the constraint holds before the account link fires.
CREATE UNIQUE INDEX IF NOT EXISTS university_community_reactions_uq
  ON university_community_reactions (reactor_email, target_type, target_id, emoji);

-- Count + "did I react" lookups for a target.
CREATE INDEX IF NOT EXISTS university_community_reactions_target_idx
  ON university_community_reactions (target_type, target_id);

-- The moderation queue. A report bumps an open-report count toward the
-- auto-hide threshold; one report per member per target prevents report-spam.
CREATE TABLE IF NOT EXISTS university_community_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_email TEXT NOT NULL,                      -- lowercased; who reported
  account_id UUID REFERENCES customer_accounts(id),
  target_type TEXT NOT NULL,                         -- 'post' | 'comment'
  target_id UUID NOT NULL,
  reason TEXT,                                       -- optional free-text (service-capped)
  status TEXT NOT NULL DEFAULT 'open',               -- open | actioned | dismissed
  resolved_by TEXT,                                  -- admin actor when actioned/dismissed
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One report per member per target (no report-spam). Keyed on the durable
-- email identity so the constraint holds before the account link fires.
CREATE UNIQUE INDEX IF NOT EXISTS university_community_reports_uq
  ON university_community_reports (reporter_email, target_type, target_id);

-- The admin review queue: open reports, oldest first.
CREATE INDEX IF NOT EXISTS university_community_reports_status_idx
  ON university_community_reports (status, created_at);

-- "How many open reports on this item" — the auto-hide threshold lookup.
CREATE INDEX IF NOT EXISTS university_community_reports_target_idx
  ON university_community_reports (target_type, target_id);

-- In-app notifications — "someone replied to your post/comment". Drives the
-- sidebar unread badge. The natural home for v2 mentions (kind='mention').
CREATE TABLE IF NOT EXISTS university_community_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  recipient_email TEXT NOT NULL,                     -- lowercased; who gets notified
  actor_email TEXT NOT NULL,                         -- lowercased; who triggered it
  kind TEXT NOT NULL DEFAULT 'reply',                -- reply (MVP); mention (v2)
  post_id UUID REFERENCES university_community_posts(id),
  comment_id UUID REFERENCES university_community_comments(id),
  read_at TIMESTAMPTZ,                               -- null = unread
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unread-count query: a recipient's unread notifications.
CREATE INDEX IF NOT EXISTS university_community_notifications_unread_idx
  ON university_community_notifications (recipient_email, read_at);

CREATE INDEX IF NOT EXISTS university_community_notifications_account_idx
  ON university_community_notifications (account_id);
