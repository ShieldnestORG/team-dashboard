import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Campaigns — group content items by brand initiative.
 * Allows scheduling, filtering, and performance reporting across brands.
 *
 * brand: 'cd' | 'tokns' | 'tx' | 'shieldnest' | 'directory' | 'partners'
 * status: 'draft' | 'active' | 'paused' | 'complete'
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    brand: text("brand").notNull().default("cd"),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"), // draft | active | paused | complete
    goal: text("goal"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    targetSites: jsonb("target_sites").$type<string[]>().default([]),
    personalityAllowlist: jsonb("personality_allowlist").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdIdx: index("idx_campaigns_company_id").on(table.companyId),
    brandIdx: index("idx_campaigns_brand").on(table.brand),
    statusIdx: index("idx_campaigns_status").on(table.status),
  }),
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
