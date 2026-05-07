-- Social posts queue — text-first scheduled posts for the socials relayer.
-- Worker (`socials:relay` cron) drains rows where status='scheduled'
-- AND scheduled_at <= now(), dispatching to the platform publisher
-- resolved from social_accounts.platform.
-- See docs/products/socials-hub.md (Phase 2 — Control).

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  alt_texts JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to_url TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'scheduled',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  posted_url TEXT,
  platform_post_id TEXT,
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ
);

-- Partial index — relayer worker reads only this slice.
CREATE INDEX IF NOT EXISTS social_posts_due_idx
  ON social_posts (scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS social_posts_account_idx
  ON social_posts (social_account_id);

CREATE INDEX IF NOT EXISTS social_posts_status_idx
  ON social_posts (status);
