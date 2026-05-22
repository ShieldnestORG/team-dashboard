import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigint,
  real,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export interface VideoEditOptions {
  /** Aspect ratio for the final render. */
  aspect?: "16:9" | "9:16" | "1:1";
  /** Color grade hint forwarded to the engine (e.g. "cinematic", "off", "auto"). */
  colorGrade?: string;
  /** Burn 2-word UPPERCASE captions into the final video. */
  burnCaptions?: boolean;
  /** Target duration in seconds — engine may not honor strictly. */
  targetDurationSec?: number;
  /** Free-form engine-specific options forwarded verbatim. */
  extra?: Record<string, unknown>;
}

export const videoEditJobs = pgTable(
  "video_edit_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    engine: text("engine").notNull().default("video-use"),
    status: text("status").notNull().default("pending"), // pending|running|ready|failed|canceled
    inputDir: text("input_dir").notNull(),
    editBrief: text("edit_brief").notNull(),
    options: jsonb("options").$type<VideoEditOptions>(),
    outputPath: text("output_path"),
    durationSec: real("duration_sec"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    filesPurgedAt: timestamp("files_purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("video_edit_jobs_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    createdIdx: index("video_edit_jobs_created_idx").on(table.createdAt),
  }),
);

export type VideoEditJob = typeof videoEditJobs.$inferSelect;
export type NewVideoEditJob = typeof videoEditJobs.$inferInsert;
