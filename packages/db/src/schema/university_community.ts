import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { customerAccounts } from "./customer_portal.js";

// ---------------------------------------------------------------------------
// Coherent Ones University — native COMMUNITY feed. The "Do, between sessions"
// beat of the Coherent Loop: a members-only async feed where members post short
// updates, comment on each other, and react ("Resonate") between live sessions.
//
// Five tables (see 0126_university_community.sql):
//   - university_community_posts          — top-level posts (the feed).
//   - university_community_comments       — replies on a post (the thread).
//   - university_community_reactions      — one "Resonate" per member per target.
//   - university_community_reports        — the moderation queue (report → auto-hide).
//   - university_community_notifications  — in-app "someone replied to you" rows.
//
// The member is identified the same way the rest of University is — by the
// shared customer_accounts login (account_id once the linker has fired) joined
// on the lowercased `email` as the durable author key. Both are stored on each
// row so attribution holds before AND after the account link resolves. The
// author display name is resolved at read time from university_members.
//
// comment_count / reaction_count are denormalized for the feed and maintained
// in the same transaction as the write that changes them; the rows remain the
// source of truth. Posts/comments are soft-deleted (status='removed', kept for
// audit, never rendered). Reactions are the one place rows are deleted (a
// withdrawn reaction carries no audit value).
// ---------------------------------------------------------------------------

export const universityCommunityPosts = pgTable(
  "university_community_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `author_email` is the durable key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable author key. Lowercased before insert.
    authorEmail: text("author_email").notNull(),
    // Plain text; length-capped + profanity-gated in the service.
    body: text("body").notNull(),
    // Denormalized; maintained in the comment write txn. Rows are the truth.
    commentCount: integer("comment_count").notNull().default(0),
    // Denormalized; maintained on react/unreact.
    reactionCount: integer("reaction_count").notNull().default(0),
    // visible | hidden | removed
    status: text("status").notNull().default("visible"),
    // Set when status != visible: report | profanity | admin
    hiddenReason: text("hidden_reason"),
    // statement (default catch-all) | question | idea. CHECK-gated in SQL.
    postType: text("post_type").notNull().default("statement"),
    // Optional curated topic slug (wins | tools_workflows | body_mind |
    // building_revenue | meta); nullable. CHECK-gated in SQL.
    topic: text("topic"),
    // The single source of truth for "answered": the chosen comment. Nullable;
    // only question posts are ever accepted (enforced in the service).
    // AnyPgColumn breaks the posts<->comments circular reference (repo convention).
    acceptedCommentId: uuid("accepted_comment_id").references(
      (): AnyPgColumn => universityCommunityComments.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // The feed query: visible posts, newest first.
    feedIdx: index("university_community_posts_feed_idx").on(
      table.status,
      table.createdAt.desc(),
    ),
    authorIdx: index("university_community_posts_author_idx").on(
      table.authorEmail,
    ),
    accountIdx: index("university_community_posts_account_idx").on(
      table.accountId,
    ),
    // Type filter + Open-questions board: visible posts of a type, newest first.
    typeIdx: index("university_community_posts_type_idx").on(
      table.postType,
      table.status,
      table.createdAt.desc(),
    ),
    // Topic filter: visible posts under a topic, newest first.
    topicIdx: index("university_community_posts_topic_idx").on(
      table.topic,
      table.status,
      table.createdAt.desc(),
    ),
  }),
);

export const universityCommunityComments = pgTable(
  "university_community_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => universityCommunityPosts.id),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `author_email` is the durable key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable author key. Lowercased before insert.
    authorEmail: text("author_email").notNull(),
    // Plain text; length-capped + profanity-gated in the service.
    body: text("body").notNull(),
    // visible | hidden | removed
    status: text("status").notNull().default("visible"),
    hiddenReason: text("hidden_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Thread render: a post's visible comments, oldest first.
    threadIdx: index("university_community_comments_thread_idx").on(
      table.postId,
      table.status,
      table.createdAt,
    ),
    authorIdx: index("university_community_comments_author_idx").on(
      table.authorEmail,
    ),
    accountIdx: index("university_community_comments_account_idx").on(
      table.accountId,
    ),
  }),
);

export const universityCommunityReactions = pgTable(
  "university_community_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `reactor_email` is the durable key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable reactor key. Lowercased before insert.
    reactorEmail: text("reactor_email").notNull(),
    // 'post' | 'comment'
    targetType: text("target_type").notNull(),
    // Polymorphic post/comment id — no FK; integrity enforced in the service.
    targetId: uuid("target_id").notNull(),
    // MVP single kind ('resonate'); column accommodates a v2 palette.
    emoji: text("emoji").notNull().default("resonate"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Idempotency: one reaction per member+target+emoji. A double-tap is a
    // no-op (ON CONFLICT DO NOTHING in the service). Keyed on the durable email
    // identity so the constraint holds before the account link fires.
    reactionUq: uniqueIndex("university_community_reactions_uq").on(
      table.reactorEmail,
      table.targetType,
      table.targetId,
      table.emoji,
    ),
    targetIdx: index("university_community_reactions_target_idx").on(
      table.targetType,
      table.targetId,
    ),
  }),
);

export const universityCommunityReports = pgTable(
  "university_community_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The durable reporter key. Lowercased before insert.
    reporterEmail: text("reporter_email").notNull(),
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // 'post' | 'comment'
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    // Optional free-text reason (service-capped).
    reason: text("reason"),
    // open | actioned | dismissed
    status: text("status").notNull().default("open"),
    // Admin actor when actioned/dismissed.
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One report per member per target (no report-spam). Keyed on the durable
    // email identity so the constraint holds before the account link fires.
    reportUq: uniqueIndex("university_community_reports_uq").on(
      table.reporterEmail,
      table.targetType,
      table.targetId,
    ),
    statusIdx: index("university_community_reports_status_idx").on(
      table.status,
      table.createdAt,
    ),
    targetIdx: index("university_community_reports_target_idx").on(
      table.targetType,
      table.targetId,
    ),
  }),
);

export const universityCommunityNotifications = pgTable(
  "university_community_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `recipient_email` is the durable key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable recipient key. Lowercased before insert.
    recipientEmail: text("recipient_email").notNull(),
    // Who triggered it. Lowercased before insert.
    actorEmail: text("actor_email").notNull(),
    // reply (MVP); mention (v2)
    kind: text("kind").notNull().default("reply"),
    postId: uuid("post_id").references(() => universityCommunityPosts.id),
    commentId: uuid("comment_id").references(
      () => universityCommunityComments.id,
    ),
    // null = unread
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Unread-count query: a recipient's unread notifications.
    unreadIdx: index("university_community_notifications_unread_idx").on(
      table.recipientEmail,
      table.readAt,
    ),
    accountIdx: index("university_community_notifications_account_idx").on(
      table.accountId,
    ),
  }),
);

export type UniversityCommunityPost =
  typeof universityCommunityPosts.$inferSelect;
export type NewUniversityCommunityPost =
  typeof universityCommunityPosts.$inferInsert;
export type UniversityCommunityComment =
  typeof universityCommunityComments.$inferSelect;
export type NewUniversityCommunityComment =
  typeof universityCommunityComments.$inferInsert;
export type UniversityCommunityReaction =
  typeof universityCommunityReactions.$inferSelect;
export type NewUniversityCommunityReaction =
  typeof universityCommunityReactions.$inferInsert;
export type UniversityCommunityReport =
  typeof universityCommunityReports.$inferSelect;
export type NewUniversityCommunityReport =
  typeof universityCommunityReports.$inferInsert;
export type UniversityCommunityNotification =
  typeof universityCommunityNotifications.$inferSelect;
export type NewUniversityCommunityNotification =
  typeof universityCommunityNotifications.$inferInsert;
