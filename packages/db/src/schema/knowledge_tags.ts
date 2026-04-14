import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const knowledgeTags = pgTable(
  "knowledge_tags",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagType: text("tag_type").notNull().default("technology"),
    description: text("description"),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    // embedding stored as vector(1024) in postgres via migration;
    // Drizzle doesn't have native pgvector support, so we use raw SQL for vector ops
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("knowledge_tags_slug_idx").on(table.slug),
    typeIdx: index("knowledge_tags_type_idx").on(table.tagType),
  }),
);
