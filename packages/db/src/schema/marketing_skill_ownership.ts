import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// ---------------------------------------------------------------------------
// Marketing Skill Ownership — DB mirror of the in-code registry in
// server/src/services/marketing-skill-registry.ts. The registry is the
// source of truth at deploy time; this table is the runtime-mutable
// projection a board admin can audit/override.
//
// UNIQUE (company_id, skill_key) enforces single-owner-per-skill at the DB
// layer in addition to the type-level guarantee of the registry.
// ---------------------------------------------------------------------------

export const marketingSkillOwnership = pgTable(
  "marketing_skill_ownership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    skillKey: text("skill_key").notNull(),
    ownerAgentId: uuid("owner_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySkillUnique: uniqueIndex("marketing_skill_ownership_company_skill_idx").on(
      table.companyId,
      table.skillKey,
    ),
  }),
);

export type MarketingSkillOwnership = typeof marketingSkillOwnership.$inferSelect;
export type NewMarketingSkillOwnership = typeof marketingSkillOwnership.$inferInsert;
