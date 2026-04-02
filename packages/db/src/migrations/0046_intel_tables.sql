CREATE TABLE IF NOT EXISTS "intel_companies" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "intel_companies_slug_uq" ON "intel_companies" USING btree ("slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_slug" text NOT NULL,
  "report_type" text NOT NULL,
  "headline" text NOT NULL,
  "body" text NOT NULL,
  "source_url" text,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_intel_reports_company" ON "intel_reports" USING btree ("company_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_intel_reports_captured" ON "intel_reports" USING btree ("captured_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_intel_reports_dedup" ON "intel_reports" ("company_slug", "source_url") WHERE "source_url" IS NOT NULL;
