import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { creditscoreReports, creditscoreSubscriptions } from "./creditscore.js";

// ---------------------------------------------------------------------------
// CreditScore fulfillment-agent outputs — Schema Agent (Core),
// Competitor Agent (Forge), Sage Strategist (Sage).
// ---------------------------------------------------------------------------

export const creditscoreSchemaImpls = pgTable(
  "creditscore_schema_impls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => creditscoreSubscriptions.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    cycleTag: text("cycle_tag").notNull(),
    cycleIndex: integer("cycle_index").notNull(),
    // schema.org type: Organization | Product | Article | FAQPage | LocalBusiness | etc.
    schemaType: text("schema_type").notNull(),
    // The JSON-LD object serialized.
    jsonLd: jsonb("json_ld").notNull().default({}),
    // Copy-paste <script type="application/ld+json"> snippet for customer install.
    htmlSnippet: text("html_snippet").notNull(),
    promptMeta: jsonb("prompt_meta").notNull().default({}),
    // status: pending_review | approved | rejected | delivered
    status: text("status").notNull().default("pending_review"),
    reviewNotes: text("review_notes"),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedByAgentId: uuid("reviewed_by_agent_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subscriptionIdx: index("creditscore_schema_impls_subscription_idx").on(table.subscriptionId),
    statusIdx: index("creditscore_schema_impls_status_idx").on(table.status),
    cycleIdx: index("creditscore_schema_impls_cycle_idx").on(
      table.subscriptionId,
      table.cycleTag,
      table.cycleIndex,
    ),
  }),
);

export const creditscoreCompetitorScans = pgTable(
  "creditscore_competitor_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => creditscoreSubscriptions.id, { onDelete: "cascade" }),
    // The primary report this competitor scan was spawned from.
    parentReportId: uuid("parent_report_id").references(() => creditscoreReports.id, {
      onDelete: "set null",
    }),
    cycleTag: text("cycle_tag").notNull(),
    customerDomain: text("customer_domain").notNull(),
    competitorDomain: text("competitor_domain").notNull(),
    competitorScore: integer("competitor_score"),
    customerScore: integer("customer_score"),
    // Raw audit result + narrative gap summary.
    auditJson: jsonb("audit_json").notNull().default({}),
    gapSummary: text("gap_summary"),
    // status: pending | complete | failed
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subscriptionIdx: index("creditscore_competitor_scans_subscription_idx").on(
      table.subscriptionId,
    ),
    cycleIdx: index("creditscore_competitor_scans_cycle_idx").on(
      table.subscriptionId,
      table.cycleTag,
    ),
    parentIdx: index("creditscore_competitor_scans_parent_idx").on(table.parentReportId),
  }),
);

export const creditscoreStrategyDocs = pgTable(
  "creditscore_strategy_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => creditscoreSubscriptions.id, { onDelete: "cascade" }),
    cycleTag: text("cycle_tag").notNull(), // ISO week: "2026-W17"
    weekOf: timestamp("week_of", { withTimezone: true }).notNull(),
    docHtml: text("doc_html").notNull(),
    docMarkdown: text("doc_markdown"),
    promptMeta: jsonb("prompt_meta").notNull().default({}),
    // status: draft | delivered | failed
    status: text("status").notNull().default("draft"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subscriptionIdx: index("creditscore_strategy_docs_subscription_idx").on(
      table.subscriptionId,
    ),
    cycleIdx: index("creditscore_strategy_docs_cycle_idx").on(
      table.subscriptionId,
      table.cycleTag,
    ),
    statusIdx: index("creditscore_strategy_docs_status_idx").on(table.status),
  }),
);
