-- Add target_type to distinguish between @account and #keyword/phrase targets
ALTER TABLE "auto_reply_config" ADD COLUMN IF NOT EXISTS "target_type" text NOT NULL DEFAULT 'account';
-- target_type values: 'account' (watch @username), 'keyword' (watch for keyword/hashtag in tweet text)

-- Make target_x_user_id nullable for keyword targets (no user ID needed)
ALTER TABLE "auto_reply_config" ALTER COLUMN "target_x_user_id" DROP NOT NULL;
