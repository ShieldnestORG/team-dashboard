import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { socialAccounts } from "./social_accounts.js";

// Funnel Library (migration 0149_funnels). A standing library of comment->DM
// funnel drafts per Zernio-capable account — AI drafts, an admin approves,
// "arm" creates the real Zernio comment automation. See the migration header
// and server/src/services/socials/funnels-service.ts for the full lifecycle.
export const funnels = pgTable(
  "funnels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // Stable funnel-catalog.json entry id this row was seeded from, or NULL
    // for AI-drafted / admin-authored rows. Plain unique index — Postgres
    // treats NULL as distinct-from-NULL, so multiple non-catalog rows never
    // collide on this column.
    catalogId: text("catalog_id"),
    name: text("name").notNull(),
    // "@handle" (no leading @) this funnel targets.
    accountHandle: text("account_handle").notNull(),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    // 'exact' | 'contains'
    matchMode: text("match_mode").notNull().default("contains"),
    dmMessage: text("dm_message").notNull().default(""),
    destinationUrl: text("destination_url"),
    postHooks: jsonb("post_hooks").$type<string[]>().notNull().default([]),
    // 'standard' | 'controversial' | 'weird'
    style: text("style").notNull().default("standard"),
    tosRisk: text("tos_risk"),
    notes: text("notes"),
    // 'draft' | 'ready' | 'live' | 'rejected' | 'retired'
    status: text("status").notNull().default("draft"),
    // Board user id, or 'ai:<model>' for cron/generate-drafted rows.
    createdBy: text("created_by").notNull().default("system"),
    approvedByUserId: text("approved_by_user_id"),
    // Zernio's minted comment-automation id while status = 'live'.
    zernioAutomationId: text("zernio_automation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    catalogIdUq: uniqueIndex("funnels_catalog_id_uq").on(table.catalogId),
    companyAccountIdx: index("funnels_company_account_idx").on(
      table.companyId,
      table.accountHandle,
    ),
    statusIdx: index("funnels_status_idx").on(table.status),
    statusCk: check(
      "funnels_status_ck",
      sql`${table.status} IN ('draft', 'ready', 'live', 'rejected', 'retired')`,
    ),
    styleCk: check(
      "funnels_style_ck",
      sql`${table.style} IN ('standard', 'controversial', 'weird')`,
    ),
    matchModeCk: check(
      "funnels_match_mode_ck",
      sql`${table.matchMode} IN ('exact', 'contains')`,
    ),
  }),
);

export type Funnel = typeof funnels.$inferSelect;
export type NewFunnel = typeof funnels.$inferInsert;
