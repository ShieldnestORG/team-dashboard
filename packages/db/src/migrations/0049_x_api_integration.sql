CREATE TABLE IF NOT EXISTS "x_oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"x_user_id" text NOT NULL,
	"x_username" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "x_engagement_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_tweet_id" text,
	"target_user_id" text,
	"target_username" text,
	"success" boolean DEFAULT false NOT NULL,
	"error" text,
	"api_response_ms" integer,
	"rate_limit_remaining" integer,
	"embedding_score" real,
	"executed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "x_tweet_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tweet_id" text NOT NULL,
	"tweet_text" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"retweet_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"impression_count" integer DEFAULT 0 NOT NULL,
	"quote_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "x_oauth_tokens" ADD CONSTRAINT "x_oauth_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "x_engagement_log" ADD CONSTRAINT "x_engagement_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "x_tweet_analytics" ADD CONSTRAINT "x_tweet_analytics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "x_oauth_tokens_company_id_uq" ON "x_oauth_tokens" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x_engagement_log_company_executed_idx" ON "x_engagement_log" USING btree ("company_id","executed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x_engagement_log_company_action_idx" ON "x_engagement_log" USING btree ("company_id","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x_engagement_log_company_target_username_idx" ON "x_engagement_log" USING btree ("company_id","target_username");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "x_tweet_analytics_company_tweet_uq" ON "x_tweet_analytics" USING btree ("company_id","tweet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "x_tweet_analytics_company_posted_idx" ON "x_tweet_analytics" USING btree ("company_id","posted_at");