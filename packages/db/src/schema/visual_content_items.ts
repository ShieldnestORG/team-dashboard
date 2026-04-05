import { pgTable, uuid, text, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const visualContentItems = pgTable(
  "visual_content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: text("agent_id"),
    contentType: text("content_type").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull().default("queued"),
    prompt: text("prompt").notNull(),
    scriptText: text("script_text"),
    backend: text("backend"),
    metadata: jsonb("metadata"),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewComment: text("review_comment"),
    jobId: text("job_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("visual_content_items_company_created_idx").on(table.companyId, table.createdAt),
    companyStatusIdx: index("visual_content_items_company_status_idx").on(table.companyId, table.status),
  }),
);

export const visualContentAssets = pgTable(
  "visual_content_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visualContentItemId: uuid("visual_content_item_id")
      .notNull()
      .references(() => visualContentItems.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    thumbnailKey: text("thumbnail_key"),
    byteSize: integer("byte_size"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    itemIdx: index("visual_content_assets_item_idx").on(table.visualContentItemId),
  }),
);
