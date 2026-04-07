CREATE TABLE "media_drops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"caption" text,
	"hashtags" text[],
	"platform" text DEFAULT 'twitter' NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"files" jsonb NOT NULL,
	"posted_tweet_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse_aggregations" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"topic" text NOT NULL,
	"tweet_count" integer DEFAULT 0 NOT NULL,
	"avg_sentiment" real,
	"total_likes" integer DEFAULT 0 NOT NULL,
	"total_retweets" integer DEFAULT 0 NOT NULL,
	"total_impressions" integer DEFAULT 0 NOT NULL,
	"top_tweet_id" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse_tweets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tweet_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_username" text NOT NULL,
	"author_name" text,
	"text" text NOT NULL,
	"tweet_created_at" timestamp with time zone NOT NULL,
	"topic" text NOT NULL,
	"sentiment_score" real,
	"metrics_likes" integer DEFAULT 0 NOT NULL,
	"metrics_retweets" integer DEFAULT 0 NOT NULL,
	"metrics_replies" integer DEFAULT 0 NOT NULL,
	"metrics_impressions" integer DEFAULT 0 NOT NULL,
	"source_query" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse_xrpl_bridge_mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tweet_id" text NOT NULL,
	"bridge_type" text NOT NULL,
	"token_mentioned" text NOT NULL,
	"staking_mentioned" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_engagement_log" (
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
CREATE TABLE "x_oauth_tokens" (
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
CREATE TABLE "x_tweet_analytics" (
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
ALTER TABLE "intel_companies" ADD COLUMN "directory" text DEFAULT 'crypto' NOT NULL;--> statement-breakpoint
ALTER TABLE "x_engagement_log" ADD CONSTRAINT "x_engagement_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_oauth_tokens" ADD CONSTRAINT "x_oauth_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_tweet_analytics" ADD CONSTRAINT "x_tweet_analytics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_drops_company_idx" ON "media_drops" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "media_drops_status_idx" ON "media_drops" USING btree ("status");--> statement-breakpoint
CREATE INDEX "media_drops_created_at_idx" ON "media_drops" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pulse_agg_period_topic_uq" ON "pulse_aggregations" USING btree ("period","period_start","topic");--> statement-breakpoint
CREATE UNIQUE INDEX "pulse_tweets_tweet_id_uq" ON "pulse_tweets" USING btree ("tweet_id");--> statement-breakpoint
CREATE INDEX "pulse_tweets_topic_idx" ON "pulse_tweets" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "pulse_tweets_created_at_idx" ON "pulse_tweets" USING btree ("tweet_created_at");--> statement-breakpoint
CREATE INDEX "pulse_tweets_author_idx" ON "pulse_tweets" USING btree ("author_username");--> statement-breakpoint
CREATE INDEX "pulse_xrpl_bridge_type_idx" ON "pulse_xrpl_bridge_mentions" USING btree ("bridge_type");--> statement-breakpoint
CREATE INDEX "pulse_xrpl_bridge_captured_idx" ON "pulse_xrpl_bridge_mentions" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "x_engagement_log_company_executed_idx" ON "x_engagement_log" USING btree ("company_id","executed_at");--> statement-breakpoint
CREATE INDEX "x_engagement_log_company_action_idx" ON "x_engagement_log" USING btree ("company_id","action");--> statement-breakpoint
CREATE INDEX "x_engagement_log_company_target_username_idx" ON "x_engagement_log" USING btree ("company_id","target_username");--> statement-breakpoint
CREATE UNIQUE INDEX "x_oauth_tokens_company_id_uq" ON "x_oauth_tokens" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "x_tweet_analytics_company_tweet_uq" ON "x_tweet_analytics" USING btree ("company_id","tweet_id");--> statement-breakpoint
CREATE INDEX "x_tweet_analytics_company_posted_idx" ON "x_tweet_analytics" USING btree ("company_id","posted_at");--> statement-breakpoint
CREATE INDEX "intel_companies_directory_idx" ON "intel_companies" USING btree ("directory");