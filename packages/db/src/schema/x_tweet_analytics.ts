import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const xTweetAnalytics = pgTable(
  "x_tweet_analytics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    tweetId: text("tweet_id").notNull(),
    tweetText: text("tweet_text").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    likeCount: integer("like_count").notNull().default(0),
    retweetCount: integer("retweet_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    impressionCount: integer("impression_count").notNull().default(0),
    quoteCount: integer("quote_count").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    companyTweetUq: uniqueIndex("x_tweet_analytics_company_tweet_uq").on(table.companyId, table.tweetId),
    companyPostedIdx: index("x_tweet_analytics_company_posted_idx").on(table.companyId, table.postedAt),
  }),
);
