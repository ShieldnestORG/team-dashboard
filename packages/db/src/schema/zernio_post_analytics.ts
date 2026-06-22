import {
  pgTable, uuid, text, integer, numeric, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { socialAccounts } from "./social_accounts.js";

// One row per (zernio account, on-platform post) — written by the
// zernio:analytics-poller cron, served by routes/socials-analytics.ts. The
// Zernio account id is NOT a column on social_accounts; it is parsed from
// social_accounts.oauth_ref ("zernio:<id>") and denormalised here so reads group
// without re-parsing. Mirrors the metrics-table shape of x_tweet_analytics.ts.
// See migration 0122_zernio_analytics.sql.
export const zernioPostAnalytics = pgTable(
  "zernio_post_analytics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    socialAccountId: uuid("social_account_id").notNull().references(() => socialAccounts.id),
    zernioAccountId: text("zernio_account_id").notNull(),
    // Zernio platform string: "instagram" | "tiktok" | "youtube" | "twitter".
    platform: text("platform").notNull(),

    zernioPostId: text("zernio_post_id"),
    platformPostId: text("platform_post_id"),
    platformPostUrl: text("platform_post_url"),
    contentPreview: text("content_preview"),

    publishedAt: timestamp("published_at", { withTimezone: true }),

    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    views: integer("views").notNull().default(0),
    // numeric → string in JS; the read API parses to number for the contract.
    engagementRate: numeric("engagement_rate").notNull().default("0"),
    reelsAvgWatchTime: integer("reels_avg_watch_time").notNull().default(0),

    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountPostUq: uniqueIndex("zernio_post_analytics_account_post_uq").on(
      t.zernioAccountId,
      t.platformPostId,
    ),
    accountPublishedIdx: index("zernio_post_analytics_account_published_idx").on(
      t.socialAccountId,
      t.publishedAt,
    ),
    companyPublishedIdx: index("zernio_post_analytics_company_published_idx").on(
      t.companyId,
      t.publishedAt,
    ),
  }),
);

export type ZernioPostAnalytics = typeof zernioPostAnalytics.$inferSelect;
export type NewZernioPostAnalytics = typeof zernioPostAnalytics.$inferInsert;
