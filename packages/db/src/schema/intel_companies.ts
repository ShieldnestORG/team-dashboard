import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const intelCompanies = pgTable(
  "intel_companies",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    directory: text("directory").notNull().default("crypto"),
    description: text("description").notNull(),
    website: text("website"),
    coingeckoId: text("coingecko_id"),
    githubOrg: text("github_org"),
    subreddit: text("subreddit"),
    twitterHandle: text("twitter_handle"),
    rssFeeds: jsonb("rss_feeds").$type<string[]>().default([]),
    contactEmail: text("contact_email"),
    contactName: text("contact_name"),
    contactNotes: text("contact_notes"),
    contactSource: text("contact_source"),
    contactVerifiedAt: timestamp("contact_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex("intel_companies_slug_uq").on(table.slug),
    directoryIdx: index("intel_companies_directory_idx").on(table.directory),
  }),
);
