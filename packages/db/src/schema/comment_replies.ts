import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { launchTrackedItems } from "./launch_tracked_items.js";

// ---------------------------------------------------------------------------
// Comment Replies — one row per external comment seen on a tracked launch
// post. Populated by the launch-comment-monitor cron. Status lifecycle:
//   pending → replied | dismissed | needs_custom
//
// `suggested_reply` is only populated when the Claude Haiku classifier
// returns confidence >= 0.85 against one of the 8 documented pushback
// patterns. Below threshold the row is still stored (status=pending or
// needs_custom) so the human reviewer can decide.
// ---------------------------------------------------------------------------

export const commentReplies = pgTable(
  "comment_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    trackedItemId: uuid("tracked_item_id")
      .notNull()
      .references(() => launchTrackedItems.id, { onDelete: "cascade" }),
    // platform: hn | reddit | devto
    platform: text("platform").notNull(),
    externalCommentId: text("external_comment_id").notNull(),
    externalCommentUrl: text("external_comment_url").notNull(),
    author: text("author"),
    commentBody: text("comment_body").notNull(),
    patternId: text("pattern_id"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    suggestedReply: text("suggested_reply"),
    // status: pending | replied | dismissed | needs_custom
    status: text("status").notNull().default("pending"),
    dismissedReason: text("dismissed_reason"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniq: uniqueIndex("comment_replies_platform_external_uniq").on(
      table.platform,
      table.externalCommentId,
    ),
    statusIdx: index("comment_replies_status_idx").on(table.status),
    companyStatusIdx: index("comment_replies_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);

export type CommentReply = typeof commentReplies.$inferSelect;
export type NewCommentReply = typeof commentReplies.$inferInsert;
