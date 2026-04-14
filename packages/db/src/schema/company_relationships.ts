import {
  pgTable,
  serial,
  text,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const companyRelationships = pgTable(
  "company_relationships",
  {
    id: serial("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    relationship: text("relationship").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    confidence: real("confidence").notNull().default(0.5),
    evidenceReportIds: jsonb("evidence_report_ids").$type<number[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    extractedBy: text("extracted_by"),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceIdx: index("idx_cr_source_drizzle").on(table.sourceType, table.sourceId),
    targetIdx: index("idx_cr_target_drizzle").on(table.targetType, table.targetId),
    relationshipIdx: index("idx_cr_relationship_drizzle").on(table.relationship),
    uniqueEdge: uniqueIndex("cr_unique_edge").on(
      table.sourceType,
      table.sourceId,
      table.relationship,
      table.targetType,
      table.targetId,
    ),
  }),
);
