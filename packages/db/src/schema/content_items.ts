import { pgTable, uuid, text, integer, numeric, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Per-target outcome of one blog-publisher leg. Populated by blog-publisher.ts.
// url is the canonical live-render URL for the target (not the POST endpoint).
export interface PublishTargetResult {
  success: boolean;
  error?: string;
  publishedAt?: string;
  url?: string;
}

export interface PublishResults {
  cd?: PublishTargetResult;
  sn?: PublishTargetResult;
  toknsApp?: PublishTargetResult;
}

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
    // brand controls which X account / publish target this content belongs to
    // Valid: 'cd' | 'tokns' | 'tx' | 'shieldnest' | 'directory' | 'partners'
    brand: text("brand").notNull().default("cd"),
    // campaign_id links this item to a campaign (nullable)
    campaignId: text("campaign_id"),
    // Blog-post publish tracking (nullable for non-blog rows).
    slug: text("slug"),
    publishResults: jsonb("publish_results").$type<PublishResults>().notNull().default({} as PublishResults),
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
    slugIdx: index("content_items_slug_idx").on(table.slug),
  }),
);
