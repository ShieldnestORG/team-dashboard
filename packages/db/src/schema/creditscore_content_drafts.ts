import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { creditscoreSubscriptions } from "./creditscore.js";

// ---------------------------------------------------------------------------
// CreditScore Content Agent (Cipher) — AI-drafted AEO-optimized pages.
//
// For Growth customers (2/mo) and Pro (4/mo), the Content Agent generates
// draft HTML pages targeting AEO gaps surfaced by the latest audit. Each
// draft lands in this review queue; a board admin approves/rejects before
// the customer publishes to their own site.
//
// One row per draft. `cycleTag` lets the monthly cron dedupe so a single
// crash/retry cycle doesn't spawn duplicate drafts.
// ---------------------------------------------------------------------------

export const creditscoreContentDrafts = pgTable(
  "creditscore_content_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => creditscoreSubscriptions.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    // ISO month tag (e.g. "2026-04") — unique index on (subscription_id,
    // cycle_tag, cycle_index) prevents duplicates within a run.
    cycleTag: text("cycle_tag").notNull(),
    cycleIndex: integer("cycle_index").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    targetSignal: text("target_signal"),
    htmlDraft: text("html_draft").notNull(),
    markdownDraft: text("markdown_draft"),
    promptMeta: jsonb("prompt_meta").notNull().default({}),
    // status: pending_review | approved | rejected | published
    status: text("status").notNull().default("pending_review"),
    reviewNotes: text("review_notes"),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedByAgentId: uuid("reviewed_by_agent_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    publishedUrl: text("published_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subscriptionIdx: index("creditscore_content_drafts_subscription_idx").on(
      table.subscriptionId,
    ),
    statusIdx: index("creditscore_content_drafts_status_idx").on(table.status),
    cycleIdx: index("creditscore_content_drafts_cycle_idx").on(
      table.subscriptionId,
      table.cycleTag,
      table.cycleIndex,
    ),
  }),
);
