import { pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const platformCaps = pgTable("platform_caps", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull().unique(),
  maxGeneratedPerDay: integer("max_generated_per_day").notNull(),
  maxPublishedPerDay: integer("max_published_per_day").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
