import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Watchtower brand-mention monitor — v1.
//
// Companion to coherencedaddy.com's storefront. A row in
// `watchtower_subscriptions` is one (brand, prompts[]) bundle. The weekly
// cron (`watchtower:weekly-runs`) replays each prompt against each engine
// (chatgpt | claude | perplexity | gemini) and records a row per result.
//
// v1 mention detection is naive (substring of brand or domain) and v1
// sentiment is a tiny keyword bag — see docs/products/watchtower.md and
// the comments in services/watchtower-monitor.ts. Both are flagged as
// not-for-marketing-claims until v2 detection ships.
// ---------------------------------------------------------------------------

export const watchtowerSubscriptions = pgTable("watchtower_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable for v1 — portal auth (and account_id wiring) lands with
  // Worker A. The cron only requires the brand + prompts to run.
  accountId: uuid("account_id"),
  brandName: text("brand_name").notNull(),
  domain: text("domain"),
  // string[] of prompts to monitor.
  prompts: jsonb("prompts").notNull(),
  // active | paused | past_due | cancelled
  status: text("status").notNull().default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Stable plan key — currently single-tier 'watchtower_monthly'.
  // Reserved space for a future daily upsell tier.
  plan: text("plan").notNull().default("watchtower_monthly"),
  // Captured at checkout. Digest recipient fallback until per-account
  // email lookup ships (see docs/products/watchtower.md follow-up #1).
  email: text("email"),
  // weekly | daily — v1 ships weekly only; the daily cadence is reserved
  // for an upsell tier and not yet wired into a cron.
  frequency: text("frequency").notNull().default("weekly"),
  promptCap: integer("prompt_cap").notNull().default(25),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const watchtowerRuns = pgTable(
  "watchtower_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => watchtowerSubscriptions.id, { onDelete: "cascade" }),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    // Engines actually queried this run (skipped engines aren't listed).
    engines: text("engines").array().notNull(),
    totalPrompts: integer("total_prompts").notNull(),
    mentionCount: integer("mention_count").notNull(),
    summary: jsonb("summary"),
  },
  (table) => ({
    subRunAtIdx: index("watchtower_runs_sub_run_at_idx").on(
      table.subscriptionId,
      table.runAt,
    ),
  }),
);

export const watchtowerResults = pgTable(
  "watchtower_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => watchtowerRuns.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    // chatgpt | claude | perplexity | gemini
    engine: text("engine").notNull(),
    mentioned: boolean("mentioned").notNull(),
    // positive | neutral | negative | unknown — see service for v1 rules
    sentiment: text("sentiment"),
    excerpt: text("excerpt"),
    rawResponse: text("raw_response"),
    latencyMs: integer("latency_ms"),
  },
  (table) => ({
    runIdx: index("watchtower_results_run_idx").on(table.runId),
  }),
);

export type WatchtowerSubscription =
  typeof watchtowerSubscriptions.$inferSelect;
export type NewWatchtowerSubscription =
  typeof watchtowerSubscriptions.$inferInsert;
export type WatchtowerRun = typeof watchtowerRuns.$inferSelect;
export type NewWatchtowerRun = typeof watchtowerRuns.$inferInsert;
export type WatchtowerResult = typeof watchtowerResults.$inferSelect;
export type NewWatchtowerResult = typeof watchtowerResults.$inferInsert;
