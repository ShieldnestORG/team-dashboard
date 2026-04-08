CREATE TABLE IF NOT EXISTS "auto_reply_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "target_x_user_id" text NOT NULL,
  "target_x_username" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "reply_mode" text NOT NULL DEFAULT 'template',
  "reply_templates" jsonb,
  "ai_prompt" text,
  "max_replies_per_day" integer NOT NULL DEFAULT 5,
  "min_delay_seconds" integer NOT NULL DEFAULT 3,
  "max_delay_seconds" integer NOT NULL DEFAULT 15,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "auto_reply_config_company_target_uq" ON "auto_reply_config" ("company_id", "target_x_user_id");
CREATE INDEX IF NOT EXISTS "auto_reply_config_enabled_idx" ON "auto_reply_config" ("enabled");

CREATE TABLE IF NOT EXISTS "auto_reply_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "config_id" uuid NOT NULL REFERENCES "auto_reply_config"("id"),
  "source_tweet_id" text NOT NULL,
  "source_author_username" text NOT NULL,
  "reply_tweet_id" text,
  "reply_text" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "error" text,
  "latency_ms" integer,
  "source" text NOT NULL DEFAULT 'stream',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "auto_reply_log_config_idx" ON "auto_reply_log" ("config_id");
CREATE INDEX IF NOT EXISTS "auto_reply_log_source_tweet_idx" ON "auto_reply_log" ("source_tweet_id");
CREATE INDEX IF NOT EXISTS "auto_reply_log_created_idx" ON "auto_reply_log" ("created_at");
