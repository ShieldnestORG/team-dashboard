CREATE TABLE IF NOT EXISTS "system_crons" (
  "job_name" text PRIMARY KEY NOT NULL,
  "schedule" text NOT NULL,
  "schedule_override" text,
  "owner_agent" text NOT NULL,
  "source_file" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamp with time zone,
  "last_duration_ms" integer,
  "last_error" text,
  "next_run_at" timestamp with time zone,
  "run_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
