CREATE TABLE "content_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"personality_id" text NOT NULL,
	"content_type" text NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" text NOT NULL,
	"topic" text NOT NULL,
	"context_query" text,
	"model" text,
	"char_count" integer,
	"char_limit" integer,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"review_comment" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"website" text,
	"coingecko_id" text,
	"github_org" text,
	"subreddit" text,
	"twitter_handle" text,
	"rss_feeds" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_slug" text NOT NULL,
	"report_type" text NOT NULL,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"source_url" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visual_content_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visual_content_item_id" uuid NOT NULL,
	"type" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"thumbnail_key" text,
	"byte_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visual_content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" text,
	"content_type" text NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"prompt" text NOT NULL,
	"script_text" text,
	"backend" text,
	"metadata" jsonb,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"review_comment" text,
	"job_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_feedback" ADD CONSTRAINT "content_feedback_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_content_assets" ADD CONSTRAINT "visual_content_assets_visual_content_item_id_visual_content_items_id_fk" FOREIGN KEY ("visual_content_item_id") REFERENCES "public"."visual_content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_content_items" ADD CONSTRAINT "visual_content_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_feedback_company_type_created_idx" ON "content_feedback" USING btree ("company_id","content_type","created_at");--> statement-breakpoint
CREATE INDEX "content_feedback_content_item_idx" ON "content_feedback" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "content_items_company_created_idx" ON "content_items" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "content_items_company_status_idx" ON "content_items" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "content_items_company_personality_platform_idx" ON "content_items" USING btree ("company_id","personality_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "intel_companies_slug_uq" ON "intel_companies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_intel_reports_company" ON "intel_reports" USING btree ("company_slug");--> statement-breakpoint
CREATE INDEX "idx_intel_reports_captured" ON "intel_reports" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "visual_content_assets_item_idx" ON "visual_content_assets" USING btree ("visual_content_item_id");--> statement-breakpoint
CREATE INDEX "visual_content_items_company_created_idx" ON "visual_content_items" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "visual_content_items_company_status_idx" ON "visual_content_items" USING btree ("company_id","status");