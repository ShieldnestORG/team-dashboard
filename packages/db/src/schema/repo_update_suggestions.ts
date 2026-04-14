import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Advisory SEO/AEO audit queue. Sage runs a weekly audit against monitored
 * sites, and every failure becomes a row here. The admin approves / rejects
 * / replies in the /repo-updates page. Nothing is ever auto-pushed.
 */
export const repoUpdateSuggestions = pgTable(
  "repo_update_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repo: text("repo").notNull(),
    siteUrl: text("site_url").notNull(),
    filePath: text("file_path"),
    checklistItem: text("checklist_item").notNull(),
    severity: text("severity").notNull().default("medium"),
    issue: text("issue").notNull(),
    rationale: text("rationale"),
    proposedPatch: text("proposed_patch"),
    language: text("language").notNull().default("typescript"),
    status: text("status").notNull().default("pending"),
    adminResponse: text("admin_response"),
    auditRunId: text("audit_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("idx_repo_update_suggestions_status").on(table.status),
    repoIdx: index("idx_repo_update_suggestions_repo").on(table.repo),
    createdIdx: index("idx_repo_update_suggestions_created").on(table.createdAt),
  }),
);
