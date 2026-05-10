import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// answer-check — free single-prompt brand-mention check tool.
//
// Funnel-top wedge for the paid Watchtower product. Visitor types one
// prompt, we run it against all four engines once, render the result,
// then optionally capture an email for a fuller report. Unlike
// watchtower_subscriptions, there is no recurring obligation; each row
// is one anonymous (or email-gated) one-shot run.
//
// `per_engine` JSONB shape:
//   [{ engine, mentioned, sentiment, excerpt, latencyMs, ok, error? }, ...]
//
// Funnel timestamps:
//   created_at         → form submitted, run completed
//   emailed_at         → email captured, follow-up report sent
//   upsell_clicked_at  → visitor clicked through to /api/watchtower/checkout
// ---------------------------------------------------------------------------

export const answerCheckRuns = pgTable(
  "answer_check_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandName: text("brand_name").notNull(),
    domain: text("domain"),
    prompt: text("prompt").notNull(),
    email: text("email"),
    ip: text("ip"),
    perEngine: jsonb("per_engine").notNull(),
    mentionCount: integer("mention_count").notNull(),
    enginesUsed: text("engines_used").array().notNull(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    upsellClickedAt: timestamp("upsell_clicked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIdx: index("answer_check_runs_email_idx").on(table.email),
    createdIdx: index("answer_check_runs_created_idx").on(table.createdAt),
  }),
);

export type AnswerCheckRun = typeof answerCheckRuns.$inferSelect;
export type NewAnswerCheckRun = typeof answerCheckRuns.$inferInsert;
