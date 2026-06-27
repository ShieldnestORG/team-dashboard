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
// (chatgpt | claude | perplexity | gemini | grok) and records a row per result.
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
  // Opt-in Google-rank tracking (migration 0119). When trackRank is true and
  // a domain is set, the weekly run also queries self-hosted Firecrawl per
  // rank query and records the domain's position. rankQueries is a string[]
  // of keyword queries; when null the run falls back to `prompts`.
  trackRank: boolean("track_rank").notNull().default(false),
  rankQueries: jsonb("rank_queries"),
  // Optional free-text "what's true about this brand" (migration 0123).
  // When set, the weekly run fires a cheap Haiku accuracy judge that compares
  // each engine answer against this reference and flags factual
  // contradictions (see watchtower-accuracy-judge.ts). Nullable + additive:
  // subscriptions without ground truth skip the judge entirely.
  groundTruth: text("ground_truth"),
  // Opt-in GA4 traffic tracking (migration 0139). When trackGa4 is true and a
  // ga4PropertyId is set, the weekly run pulls last-7-days sessions/users/
  // newUsers/leads from the GA4 Data API and adds a "Performance" section to
  // the digest. Off by default + additive: subscriptions without it are
  // unaffected (no extra API calls, no behavior change).
  trackGa4: boolean("track_ga4").notNull().default(false),
  ga4PropertyId: text("ga4_property_id"),
  // Opt-in Google Ads spend tracking (migration 0139). When trackAds is true
  // and a googleAdsCustomerId is set, the weekly run pulls last-7-days spend/
  // clicks/conversions from the Google Ads API for the same "Performance"
  // section. Off by default + additive.
  trackAds: boolean("track_ads").notNull().default(false),
  googleAdsCustomerId: text("google_ads_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Immutable per-subscription prompt snapshot. A new row is inserted every
// time the customer edits their prompts. The `prompts` column on
// `watchtower_subscriptions` remains the source of truth for "what to run
// next"; rows here are the historical log used to detect comparison-reset
// boundaries in the portal UI and (eventually) to gate result-derived
// upsell triggers. See migration 0115 for the full rationale.
export const watchtowerPromptVersions = pgTable(
  "watchtower_prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => watchtowerSubscriptions.id, { onDelete: "cascade" }),
    // string[] of prompts snapshotted at version creation time.
    prompts: jsonb("prompts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Optional actor attribution. Nullable because the initial backfill
    // row (migration 0115) has no actor.
    createdByActorId: uuid("created_by_actor_id"),
    createdByActorType: text("created_by_actor_type"),
    createdByActorLabel: text("created_by_actor_label"),
  },
  (table) => ({
    subCreatedIdx: index("watchtower_prompt_versions_sub_created_idx").on(
      table.subscriptionId,
      table.createdAt,
    ),
  }),
);

export const watchtowerRuns = pgTable(
  "watchtower_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => watchtowerSubscriptions.id, { onDelete: "cascade" }),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    // How this run was triggered: cron (weekly job) | manual ("Run now"
    // button) | test (internal /trigger-test helper). Backs the manual-run
    // rate limiter — see checkManualRunCaps in watchtower-monitor.ts.
    trigger: text("trigger").notNull().default("cron"),
    // Engines actually queried this run (skipped engines aren't listed).
    engines: text("engines").array().notNull(),
    totalPrompts: integer("total_prompts").notNull(),
    mentionCount: integer("mention_count").notNull(),
    summary: jsonb("summary"),
    // Nullable: legacy runs from before migration 0115 have no version.
    // ON DELETE SET NULL — deleting a version (rare/unsupported) leaves
    // the historical run row intact rather than cascading.
    promptVersionId: uuid("prompt_version_id").references(
      () => watchtowerPromptVersions.id,
      { onDelete: "set null" },
    ),
  },
  (table) => ({
    subRunAtIdx: index("watchtower_runs_sub_run_at_idx").on(
      table.subscriptionId,
      table.runAt,
    ),
    promptVersionIdx: index("watchtower_runs_prompt_version_idx").on(
      table.promptVersionId,
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
    // chatgpt | claude | perplexity | gemini | grok
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
export type WatchtowerPromptVersion =
  typeof watchtowerPromptVersions.$inferSelect;
export type NewWatchtowerPromptVersion =
  typeof watchtowerPromptVersions.$inferInsert;
