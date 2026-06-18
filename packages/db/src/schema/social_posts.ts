import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { socialAccounts } from "./social_accounts.js";

// Queue of scheduled text-first social posts. The socials relayer cron
// drains rows with status='scheduled' AND scheduled_at <= now().
// See docs/products/socials-hub.md (Phase 2).
export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    altTexts: jsonb("alt_texts").$type<string[]>().notNull().default([]),
    replyToUrl: text("reply_to_url"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    // 'scheduled' | 'publishing' | 'posted' | 'failed' | 'canceled'
    status: text("status").notNull().default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    postedUrl: text("posted_url"),
    platformPostId: text("platform_post_id"),
    error: text("error"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // text (not uuid) to match auth user ids (better-auth ids are non-uuid
    // strings), consistent with created_by_user_id on every other table.
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (table) => ({
    accountIdx: index("social_posts_account_idx").on(table.socialAccountId),
    statusIdx: index("social_posts_status_idx").on(table.status),
  }),
);
