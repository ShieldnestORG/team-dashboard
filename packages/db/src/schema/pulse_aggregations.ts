import {
  pgTable,
  serial,
  text,
  timestamp,
  real,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const pulseAggregations = pgTable(
  "pulse_aggregations",
  {
    id: serial("id").primaryKey(),
    period: text("period").notNull(), // 'hour' | 'day'
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    topic: text("topic").notNull(),
    tweetCount: integer("tweet_count").notNull().default(0),
    avgSentiment: real("avg_sentiment"),
    totalLikes: integer("total_likes").notNull().default(0),
    totalRetweets: integer("total_retweets").notNull().default(0),
    totalImpressions: integer("total_impressions").notNull().default(0),
    topTweetId: text("top_tweet_id"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    periodTopicUq: uniqueIndex("pulse_agg_period_topic_uq").on(
      table.period,
      table.periodStart,
      table.topic,
    ),
  }),
);
