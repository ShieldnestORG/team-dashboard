import { pgTable, uuid, text, date, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Daily AI Brief + Inspiration Board (Phase 3, migration 0150). See the
// migration file header for the full rationale.

// Link-paste board: the team drops links to good posts they saved (mostly
// Instagram) for the daily-brief cron to mine for content/funnel ideas.
export const inspirationItems = pgTable(
  "inspiration_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    url: text("url").notNull(),
    note: text("note"),
    // text (not uuid) to match auth user ids (better-auth ids are non-uuid
    // strings), consistent with social_posts.createdByUserId.
    addedByUserId: text("added_by_user_id"),
    // 'new' | 'reviewed' | 'archived'
    status: text("status").notNull().default("new"),
    aiComment: text("ai_comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("inspiration_items_company_status_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
  }),
);

// One row per (company, brief_date) — the AI's daily read across every
// channel. `sections` shape documented in services/socials/daily-brief.ts.
export const dailyBriefs = pgTable(
  "daily_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    briefDate: date("brief_date").notNull(),
    sections: jsonb("sections").$type<Record<string, unknown>>().notNull().default({}),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDateUq: uniqueIndex("daily_briefs_company_date_uq").on(table.companyId, table.briefDate),
  }),
);

export type InspirationItem = typeof inspirationItems.$inferSelect;
export type NewInspirationItem = typeof inspirationItems.$inferInsert;
export type DailyBrief = typeof dailyBriefs.$inferSelect;
export type NewDailyBrief = typeof dailyBriefs.$inferInsert;
