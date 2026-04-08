import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const autoReplyConfig = pgTable(
  "auto_reply_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    targetType: text("target_type").notNull().default("account"), // 'account' | 'keyword'
    targetXUserId: text("target_x_user_id"), // nullable for keyword targets
    targetXUsername: text("target_x_username").notNull(), // @handle for accounts, keyword/hashtag for keywords
    enabled: boolean("enabled").notNull().default(true),
    replyMode: text("reply_mode").notNull().default("template"), // 'template' | 'ai'
    replyTemplates: jsonb("reply_templates").$type<string[]>(),
    aiPrompt: text("ai_prompt"),
    maxRepliesPerDay: integer("max_replies_per_day").notNull().default(5),
    minDelaySeconds: integer("min_delay_seconds").notNull().default(3),
    maxDelaySeconds: integer("max_delay_seconds").notNull().default(15),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyTargetUq: uniqueIndex("auto_reply_config_company_target_uq").on(
      table.companyId,
      table.targetXUserId,
    ),
    enabledIdx: index("auto_reply_config_enabled_idx").on(table.enabled),
  }),
);

export const autoReplyLog = pgTable(
  "auto_reply_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    configId: uuid("config_id").notNull().references(() => autoReplyConfig.id),
    sourceTweetId: text("source_tweet_id").notNull(),
    sourceAuthorUsername: text("source_author_username").notNull(),
    replyTweetId: text("reply_tweet_id"),
    replyText: text("reply_text").notNull(),
    status: text("status").notNull().default("pending"), // pending | sent | failed | rate_limited
    error: text("error"),
    latencyMs: integer("latency_ms"),
    source: text("source").notNull().default("stream"), // stream | poll | account-poll
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    configIdx: index("auto_reply_log_config_idx").on(table.configId),
    sourceTweetIdx: index("auto_reply_log_source_tweet_idx").on(table.sourceTweetId),
    createdIdx: index("auto_reply_log_created_idx").on(table.createdAt),
  }),
);
