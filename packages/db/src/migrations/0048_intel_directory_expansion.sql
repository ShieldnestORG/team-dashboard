-- Add directory column to intel_companies for multi-niche support
-- Existing companies default to 'crypto', new directories: ai-ml, defi, devtools

ALTER TABLE "intel_companies" ADD COLUMN IF NOT EXISTS "directory" text NOT NULL DEFAULT 'crypto';

CREATE INDEX IF NOT EXISTS "intel_companies_directory_idx" ON "intel_companies" ("directory");
