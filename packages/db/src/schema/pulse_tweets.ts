import {
  pgTable,
  serial,
  text,
  timestamp,
  real,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const pulseTweets = pgTable(
  "pulse_tweets",
  {
    id: serial("id").primaryKey(),
    tweetId: text("tweet_id").notNull(),
    authorId: text("author_id").notNull(),
    authorUsername: text("author_username").notNull(),
    authorName: text("author_name"),
    text: text("text").notNull(),
    tweetCreatedAt: timestamp("tweet_created_at", { withTimezone: true }).notNull(),
    topic: text("topic").notNull(), // tx, cosmos, xrpl-bridge, tokns, staking, general
    sentimentScore: real("sentiment_score"), // 0.0-1.0, nullable until scored
    metricsLikes: integer("metrics_likes").notNull().default(0),
    metricsRetweets: integer("metrics_retweets").notNull().default(0),
    metricsReplies: integer("metrics_replies").notNull().default(0),
    metricsImpressions: integer("metrics_impressions").notNull().default(0),
    sourceQuery: text("source_query").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tweetIdUq: uniqueIndex("pulse_tweets_tweet_id_uq").on(table.tweetId),
    topicIdx: index("pulse_tweets_topic_idx").on(table.topic),
    createdAtIdx: index("pulse_tweets_created_at_idx").on(table.tweetCreatedAt),
    authorIdx: index("pulse_tweets_author_idx").on(table.authorUsername),
  }),
);
