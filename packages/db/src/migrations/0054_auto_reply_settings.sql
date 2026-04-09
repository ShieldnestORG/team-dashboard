-- Auto-reply global settings table (one row per company)
CREATE TABLE IF NOT EXISTS "auto_reply_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "settings" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "auto_reply_settings_company_uq" ON "auto_reply_settings" USING btree ("company_id");
