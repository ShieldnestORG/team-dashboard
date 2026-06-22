import {
  pgTable, uuid, text, integer, date, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { socialAccounts } from "./social_accounts.js";

// One snapshot per (zernio account, day) — written by the zernio:analytics-poller
// cron, served by routes/socials-analytics.ts. A re-poll on the same day
// overwrites that day's row. followerHistory in the read API is the time series
// over as_of_date. Mirrors the metrics-table shape of x_tweet_analytics.ts.
// See migration 0122_zernio_analytics.sql.
export const zernioAccountAnalytics = pgTable(
  "zernio_account_analytics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    socialAccountId: uuid("social_account_id").notNull().references(() => socialAccounts.id),
    zernioAccountId: text("zernio_account_id").notNull(),
    platform: text("platform").notNull(),

    asOfDate: date("as_of_date").notNull(),

    reach: integer("reach").notNull().default(0),
    views: integer("views").notNull().default(0),
    accountsEngaged: integer("accounts_engaged").notNull().default(0),
    totalInteractions: integer("total_interactions").notNull().default(0),
    followers: integer("followers").notNull().default(0),
    profileLinksTaps: integer("profile_links_taps").notNull().default(0),

    windowStart: date("window_start"),
    windowEnd: date("window_end"),

    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountDateUq: uniqueIndex("zernio_account_analytics_account_date_uq").on(
      t.zernioAccountId,
      t.asOfDate,
    ),
    accountDateIdx: index("zernio_account_analytics_account_date_idx").on(
      t.socialAccountId,
      t.asOfDate,
    ),
    companyDateIdx: index("zernio_account_analytics_company_date_idx").on(
      t.companyId,
      t.asOfDate,
    ),
  }),
);

export type ZernioAccountAnalytics = typeof zernioAccountAnalytics.$inferSelect;
export type NewZernioAccountAnalytics = typeof zernioAccountAnalytics.$inferInsert;
