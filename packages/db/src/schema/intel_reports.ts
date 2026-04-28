import {
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const intelReports = pgTable(
  "intel_reports",
  {
    id: serial("id").primaryKey(),
    companySlug: text("company_slug").notNull(),
    reportType: text("report_type").notNull(),
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    sourceUrl: text("source_url"),
    // For GitHub-sourced rows, the canonical "<org>/<repo>" the activity came
    // from. Decoupled from companySlug so an org with many repos doesn't
    // collapse every repo onto a single umbrella slug.
    // See: migration 0098_intel_reports_source_repo.sql
    sourceRepo: text("source_repo"),
    // embedding stored as vector(1024) in postgres via migration;
    // Drizzle doesn't have native pgvector support, so we use raw SQL for vector ops
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("idx_intel_reports_company").on(table.companySlug),
    capturedIdx: index("idx_intel_reports_captured").on(table.capturedAt),
    sourceRepoIdx: index("idx_intel_reports_source_repo").on(table.sourceRepo),
  }),
);
