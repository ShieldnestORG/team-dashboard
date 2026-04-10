import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const systemCrons = pgTable("system_crons", {
  jobName: text("job_name").primaryKey().notNull(),
  schedule: text("schedule").notNull(),
  scheduleOverride: text("schedule_override"),
  ownerAgent: text("owner_agent").notNull(),
  sourceFile: text("source_file").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastDurationMs: integer("last_duration_ms"),
  lastError: text("last_error"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
