import { pgTable, uuid, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    personalityId: text("personality_id").notNull(),
    contentType: text("content_type").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull().default("draft"),
    content: text("content").notNull(),
    topic: text("topic").notNull(),
    contextQuery: text("context_query"),
    model: text("model"),
    charCount: integer("char_count"),
    charLimit: integer("char_limit"),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewComment: text("review_comment"),
    clickCount: integer("click_count").notNull().default(0),
    engagementScore: numeric("engagement_score").notNull().default("0"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("content_items_company_created_idx").on(table.companyId, table.createdAt),
    companyStatusIdx: index("content_items_company_status_idx").on(table.companyId, table.status),
    companyPersonalityPlatformIdx: index("content_items_company_personality_platform_idx").on(
      table.companyId,
      table.personalityId,
      table.platform,
    ),
  }),
);
