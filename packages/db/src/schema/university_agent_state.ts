import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Coherent Ones University — DURABLE agent-runner posting state.
//
// Backs migration 0140_university_agent_runner_state.sql. These tables move the
// runner's posting-decision state out of memory (the old plain Maps in
// agent-runner/state.ts, which reset on every deploy/restart and let an agent
// re-post a line it had just used) into Postgres so it survives restarts.
//
//   - university_agent_daily_budget — per (persona, UTC day) posting ledger:
//     daily post/comment counts, the consecutive-post streak, and a reserved
//     per-day spend column. Backs the global + per-agent daily caps.
//   - university_agent_line_usage   — the 72h post_line anti-repeat ledger; one
//     row per ambient scripted-line use.
//   - university_agent_watermark    — a GENERAL per-agent cursor store keyed by
//     (persona, kind). Deliberately general enough to also hold a 'comment'
//     cursor for the Tier 3 comment-poller. The responsive feed watermark is
//     re-derived from university_community_posts on boot and is NOT stored here.
// ---------------------------------------------------------------------------

export const universityAgentDailyBudget = pgTable(
  "university_agent_daily_budget",
  {
    agentPersonaKey: text("agent_persona_key").notNull(),
    // UTC calendar day (YYYY-MM-DD); string mode to match the runner's day key.
    day: date("day", { mode: "string" }).notNull(),
    postsCount: integer("posts_count").notNull().default(0),
    commentsCount: integer("comments_count").notNull().default(0),
    // Consecutive ambient posts by this agent today; reset to 0 by an
    // interleaved comment. Backs the "<=2 consecutive posts/agent" cap.
    consecutivePosts: integer("consecutive_posts").notNull().default(0),
    lastPostAt: timestamp("last_post_at", { withTimezone: true }),
    // Reserved for a future per-agent daily spend rollup; the live spend
    // ceiling still sums university_agent_usage. Not written by the runner yet.
    spendUsd: numeric("spend_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentPersonaKey, table.day] }),
    dayIdx: index("university_agent_daily_budget_day_idx").on(table.day),
  }),
);

export const universityAgentLineUsage = pgTable(
  "university_agent_line_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentPersonaKey: text("agent_persona_key").notNull(),
    // Stable digest (sha256 hex) of the scripted line, used for the anti-repeat
    // lookup. line_text is kept alongside for admin debugging only.
    lineHash: text("line_hash").notNull(),
    lineText: text("line_text").notNull().default(""),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    personaLineUsedIdx: index(
      "university_agent_line_usage_persona_line_used_idx",
    ).on(table.agentPersonaKey, table.lineHash, table.usedAt),
    personaUsedIdx: index("university_agent_line_usage_persona_used_idx").on(
      table.agentPersonaKey,
      table.usedAt,
    ),
  }),
);

export const universityAgentWatermark = pgTable(
  "university_agent_watermark",
  {
    agentPersonaKey: text("agent_persona_key").notNull(),
    // 'ambient' | 'comment' | ... — a general cursor kind.
    kind: text("kind").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastId: text("last_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentPersonaKey, table.kind] }),
  }),
);

export type UniversityAgentDailyBudget =
  typeof universityAgentDailyBudget.$inferSelect;
export type NewUniversityAgentDailyBudget =
  typeof universityAgentDailyBudget.$inferInsert;
export type UniversityAgentLineUsage =
  typeof universityAgentLineUsage.$inferSelect;
export type NewUniversityAgentLineUsage =
  typeof universityAgentLineUsage.$inferInsert;
export type UniversityAgentWatermark =
  typeof universityAgentWatermark.$inferSelect;
export type NewUniversityAgentWatermark =
  typeof universityAgentWatermark.$inferInsert;
