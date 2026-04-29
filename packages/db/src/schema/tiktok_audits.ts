import {
  pgTable,
  uuid,
  timestamp,
  jsonb,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { tiktokReviewSubmissions } from "./tiktok_review_submissions.js";

// Snapshot of a submitted @'s public TikTok profile, captured at audit time.
// Built by the audit pipeline (Stage 1) before the draft pipeline kicks in.

export interface ProfileSnapshot {
  followers?: number;
  following?: number;
  totalLikes?: number;
  bio?: string;
  link?: string;
}

export interface RecentVideo {
  videoId: string;
  timestamp?: string;
  views?: number;
  likes?: number;
  caption?: string;
  hashtags?: string[];
  audioId?: string;
  durationSec?: number;
}

// One entry per analyzed video — `secondsToFirstNoun` is the time-to-noun
// from a Whisper transcript of the first 3 seconds of audio. Lower is better;
// >2s is "the hook stalls."
export interface HookTiming {
  videoId: string;
  secondsToFirstNoun: number;
}

export const tiktokAudits = pgTable(
  "tiktok_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => tiktokReviewSubmissions.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),

    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),

    // Structured snapshot
    profileSnapshot: jsonb("profile_snapshot").$type<ProfileSnapshot>().notNull(),
    recentVideos: jsonb("recent_videos").$type<RecentVideo[]>().notNull().default([]),

    // Pattern-extraction results
    hookTimings: jsonb("hook_timings").$type<HookTiming[]>().notNull().default([]),
    captionLengths: jsonb("caption_lengths").$type<number[]>().notNull().default([]),

    // Numeric scores (0..1 unless noted). Drizzle stores numeric as string;
    // application code converts to number.
    bioSpecificityScore: numeric("bio_specificity_score", { precision: 3, scale: 2 }),
    postingCadenceVideosPerWeek: numeric("posting_cadence_videos_per_week", {
      precision: 5,
      scale: 2,
    }),
    postingCadenceConsistency: numeric("posting_cadence_consistency", {
      precision: 3,
      scale: 2,
    }),
    repeatHookRate: numeric("repeat_hook_rate", { precision: 3, scale: 2 }),

    // The 3 video IDs Rizz cites as receipts in the draft script
    top3ReceiptVideoIds: jsonb("top3_receipt_video_ids").$type<string[]>().notNull().default([]),

    // Full unstructured payload from the scraper (kept for re-derivation)
    rawJson: jsonb("raw_json"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    submissionIdx: index("tiktok_audits_submission_idx").on(table.submissionId),
    companyIdx: index("tiktok_audits_company_idx").on(table.companyId),
    capturedAtIdx: index("tiktok_audits_captured_at_idx").on(table.capturedAt),
  }),
);

export type TiktokAudit = typeof tiktokAudits.$inferSelect;
export type NewTiktokAudit = typeof tiktokAudits.$inferInsert;
