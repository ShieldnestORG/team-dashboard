import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// llms.txt + agents.json generator — see migration 0107 for the why.
// One job row per generation request, one output row per completion.
// ---------------------------------------------------------------------------

export const llmsTxtJobs = pgTable(
  "llms_txt_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id"),
    domain: text("domain").notNull(),
    // queued | crawling | generating | complete | failed
    status: text("status").notNull(),
    inputSitemapUrl: text("input_sitemap_url"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => ({
    statusIdx: index("llms_txt_jobs_status_idx").on(table.status),
    accountIdx: index("llms_txt_jobs_account_idx").on(table.accountId),
    domainIdx: index("llms_txt_jobs_domain_idx").on(table.domain),
  }),
);

export const llmsTxtOutputs = pgTable("llms_txt_outputs", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => llmsTxtJobs.id, { onDelete: "cascade" }),
  llmsTxt: text("llms_txt").notNull(),
  llmsFullTxt: text("llms_full_txt"),
  agentsJson: text("agents_json"),
  pageCount: integer("page_count").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});
