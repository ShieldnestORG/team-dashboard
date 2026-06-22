import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { universityMembers } from "./university.js";

// ---------------------------------------------------------------------------
// Coherent Ones University — AGENT observability (admin-only).
//
// Backs migration 0127_university_agent_identity.sql. The agent IDENTITY itself
// (is_agent, agent_persona_key, agent_paused_at, agent_pause_reason) lives on
// `university_members` (see university.ts) and is ADMIN-ONLY — it is never
// serialized into the member-facing community feed.
//
// Two tables here:
//   - university_agent_reports — deterministic problem reports the runner files
//     to admin. Code-emitted only; never model-authored. Idempotent per
//     (report_kind, dedupe_key) so a flapping failure is one row/day/kind/target
//     and dedupe still works when member_id is NULL (auth_failure).
//   - university_agent_usage   — per-agent LLM cost ledger. One row per Claude
//     call; powers the per-agent cost on the admin profile, the admin cost
//     dashboard, and the daily spend-ceiling sum.
// ---------------------------------------------------------------------------

export const universityAgentReports = pgTable(
  "university_agent_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: an auth_failure report fires precisely when the agent member is
    // missing/inactive, so there may be no member row to point at.
    memberId: uuid("member_id").references(() => universityMembers.id),
    agentPersonaKey: text("agent_persona_key"),
    // auth_failure | rate_limit | error | profanity_block | incomplete_task |
    // model_timeout | bot_challenge | safety_block | budget_exceeded
    reportKind: text("report_kind").notNull(),
    // info | warning | error | critical
    severity: text("severity").notNull().default("warning"),
    message: text("message").notNull(),
    context: jsonb("context")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // '<persona|email>:<UTC-date>:<target>' — see uq below.
    dedupeKey: text("dedupe_key").notNull().default(""),
    isResolved: boolean("is_resolved").notNull().default(false),
    reportedAt: timestamp("reported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    // Keyed on (kind, dedupe_key) — NOT member_id — so dedupe holds when
    // member_id is NULL (auth_failure).
    dedupeUq: uniqueIndex("university_agent_reports_dedupe_uq").on(
      table.reportKind,
      table.dedupeKey,
    ),
    unresolvedIdx: index("university_agent_reports_unresolved_idx").on(
      table.isResolved,
      table.reportedAt,
    ),
    memberIdx: index("university_agent_reports_member_idx").on(
      table.memberId,
      table.reportedAt,
    ),
  }),
);

export const universityAgentUsage = pgTable(
  "university_agent_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => universityMembers.id),
    agentPersonaKey: text("agent_persona_key").notNull(),
    // claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-8
    model: text("model").notNull(),
    // ambient | responsive_help | variation
    purpose: text("purpose").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Computed from model price x tokens at log time (see agent-runner/pricing).
    // numeric => string in the ORM; correct for a money ledger.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    // llm | fallback (a scripted fallback still logs a zero-cost row for counts)
    source: text("source").notNull().default("llm"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    memberIdx: index("university_agent_usage_member_idx").on(
      table.memberId,
      table.createdAt,
    ),
    createdIdx: index("university_agent_usage_created_idx").on(table.createdAt),
    modelIdx: index("university_agent_usage_model_idx").on(table.model),
  }),
);

export type UniversityAgentReport = typeof universityAgentReports.$inferSelect;
export type NewUniversityAgentReport =
  typeof universityAgentReports.$inferInsert;
export type UniversityAgentUsage = typeof universityAgentUsage.$inferSelect;
export type NewUniversityAgentUsage = typeof universityAgentUsage.$inferInsert;

// Per-agent tunable config — admin-editable (no redeploy). Seeded from persona
// defaults; the runner reads it each tick. On/off stays on university_members
// (agent_paused_at). See migration 0128.
export const universityAgentConfig = pgTable(
  "university_agent_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => universityMembers.id),
    personaKey: text("persona_key").notNull(),
    model: text("model").notNull(), // claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-8
    postProbability: numeric("post_probability", { precision: 4, scale: 3 })
      .notNull()
      .default("0.2"),
    commentProbability: numeric("comment_probability", { precision: 4, scale: 3 })
      .notNull()
      .default("0.2"),
    activeStartHour: integer("active_start_hour").notNull().default(6),
    activeEndHour: integer("active_end_hour").notNull().default(22),
    voiceNote: text("voice_note"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    memberUq: uniqueIndex("university_agent_config_member_uq").on(table.memberId),
  }),
);

export type UniversityAgentConfig = typeof universityAgentConfig.$inferSelect;
export type NewUniversityAgentConfig =
  typeof universityAgentConfig.$inferInsert;
