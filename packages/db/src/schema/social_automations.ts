import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { socialAccounts } from "./social_accounts.js";

// Mirrors the implicit cron knowledge in server/src/services/content-crons.ts so
// the Socials UI can show what's running, on what schedule, against which account.
// Phase 1: read-only mirror upserted by cron-introspect at startup.
// Phase 2: source of truth — content-crons reads from this table.
export const socialAutomations = pgTable(
  "social_automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
    // 'cron_post' | 'cron_repost' | 'reactive' | 'webhook' | 'manual'
    kind: text("kind").notNull(),
    cronExpr: text("cron_expr"),
    personalityId: text("personality_id"),
    contentType: text("content_type"),
    // Stable id from JOB_DEFS so introspection can upsert deterministically.
    sourceRef: text("source_ref").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceRefIdx: index("social_automations_source_ref_idx").on(table.sourceRef),
    accountIdx: index("social_automations_account_idx").on(table.socialAccountId),
  }),
);
