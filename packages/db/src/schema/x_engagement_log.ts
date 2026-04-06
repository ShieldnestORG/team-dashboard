import { pgTable, uuid, text, boolean, integer, real, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const xEngagementLog = pgTable(
  "x_engagement_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    action: text("action").notNull(),
    targetTweetId: text("target_tweet_id"),
    targetUserId: text("target_user_id"),
    targetUsername: text("target_username"),
    success: boolean("success").notNull().default(false),
    error: text("error"),
    apiResponseMs: integer("api_response_ms"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    embeddingScore: real("embedding_score"),
    executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    companyExecutedIdx: index("x_engagement_log_company_executed_idx").on(table.companyId, table.executedAt),
    companyActionIdx: index("x_engagement_log_company_action_idx").on(table.companyId, table.action),
    companyTargetUsernameIdx: index("x_engagement_log_company_target_username_idx").on(table.companyId, table.targetUsername),
  }),
);
