import { pgTable, serial, text, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const contentQualitySignals = pgTable(
  "content_quality_signals",
  {
    id: serial("id").primaryKey(),
    companySlug: text("company_slug").notNull(),
    penalty: numeric("penalty").notNull().default("1.0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("content_quality_signals_slug_idx").on(table.companySlug),
  }),
);
