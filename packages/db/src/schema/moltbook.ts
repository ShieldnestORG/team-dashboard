import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";

export const moltbookFeed = pgTable(
  "moltbook_feed",
  {
    id: serial("id").primaryKey(),
    postId: text("post_id").notNull().unique(),
    submolt: text("submolt").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    authorName: text("author_name").notNull(),
    authorKarma: integer("author_karma").default(0),
    upvotes: integer("upvotes").default(0),
    commentCount: integer("comment_count").default(0),
    // embedding stored as vector(1024) via migration (Drizzle lacks native pgvector)
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    engaged: boolean("engaged").default(false),
    engagementType: text("engagement_type"),
  },
  (table) => ({
    postIdx: index("idx_moltbook_feed_post").on(table.postId),
    ingestedIdx: index("idx_moltbook_feed_ingested").on(table.ingestedAt),
  }),
);

export const moltbookPosts = pgTable(
  "moltbook_posts",
  {
    id: serial("id").primaryKey(),
    moltbookPostId: text("moltbook_post_id"),
    submolt: text("submolt").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentType: text("content_type").notNull(), // 'post', 'comment', 'reply'
    parentPostId: text("parent_post_id"),
    generatedBy: text("generated_by").default("ollama"),
    promptContext: text("prompt_context"),
    // embedding stored as vector(1024) via migration
    status: text("status").default("posted"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const moltbookStats = pgTable(
  "moltbook_stats",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull().unique(),
    postsMade: integer("posts_made").default(0),
    commentsMade: integer("comments_made").default(0),
    upvotesGiven: integer("upvotes_given").default(0),
    feedItemsIngested: integer("feed_items_ingested").default(0),
    ollamaCalls: integer("ollama_calls").default(0),
    errors: integer("errors").default(0),
  },
);
