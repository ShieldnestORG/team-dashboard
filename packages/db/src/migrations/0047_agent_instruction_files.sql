CREATE TABLE IF NOT EXISTS "agent_instruction_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "relative_path" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_instruction_files_agent_path_idx" ON "agent_instruction_files" USING btree ("agent_id", "relative_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_instruction_files_company_idx" ON "agent_instruction_files" USING btree ("company_id");
