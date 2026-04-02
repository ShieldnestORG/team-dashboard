import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const intelCompanies = pgTable(
  "intel_companies",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    website: text("website"),
    coingeckoId: text("coingecko_id"),
    githubOrg: text("github_org"),
    subreddit: text("subreddit"),
    twitterHandle: text("twitter_handle"),
    rssFeeds: jsonb("rss_feeds").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex("intel_companies_slug_uq").on(table.slug),
  }),
);
