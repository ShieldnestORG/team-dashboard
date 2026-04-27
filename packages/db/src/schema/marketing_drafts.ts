import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// ---------------------------------------------------------------------------
// Marketing Drafts — review queue for off-site marketing content authored
// by Beacon / Ledger / Mint / Scribe.
//
// One row per draft. `productScope` partitions the queue by product surface
// so each marketing agent only sees its own slice. `crossPostOfDraftId`
// links a child draft (e.g. a Beacon umbrella amplification) back to the
// originating product draft. Depth is enforced to 1 in code — we do NOT
// chain reposts of reposts.
//
// Status lifecycle: pending_review → approved → published, or → rejected.
// ---------------------------------------------------------------------------

export const marketingDrafts = pgTable(
  "marketing_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // productScope: cd | creditscore | tokns | tutorials
    productScope: text("product_scope").notNull(),
    channel: text("channel").notNull(),
    ownerAgentId: uuid("owner_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    // status: pending_review | approved | rejected | published
    status: text("status").notNull().default("pending_review"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    crossPostOfDraftId: uuid("cross_post_of_draft_id").references(
      (): AnyPgColumn => marketingDrafts.id,
      { onDelete: "set null" },
    ),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedByAgentId: uuid("reviewed_by_agent_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    publishedUrl: text("published_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyScopeIdx: index("marketing_drafts_company_scope_idx").on(
      table.companyId,
      table.productScope,
    ),
    statusIdx: index("marketing_drafts_status_idx").on(table.status),
    ownerAgentIdx: index("marketing_drafts_owner_agent_idx").on(table.ownerAgentId),
    crossPostIdx: index("marketing_drafts_cross_post_idx").on(table.crossPostOfDraftId),
  }),
);

export type MarketingDraft = typeof marketingDrafts.$inferSelect;
export type NewMarketingDraft = typeof marketingDrafts.$inferInsert;
