import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// CreditScore product — plan catalog, per-customer subscriptions, stored reports.
// See docs/products/creditscore-prd.md for the product spec.
// ---------------------------------------------------------------------------

export const creditscorePlans = pgTable("creditscore_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // tier: report | starter | growth | pro
  tier: text("tier").notNull(),
  // billing_interval: one_time | monthly | annual
  billingInterval: text("billing_interval").notNull(),
  priceCents: integer("price_cents").notNull(),
  stripePriceId: text("stripe_price_id"),
  // JSONB — see creditscore-prd.md for shape (domains, rescanCadence, etc.)
  entitlements: jsonb("entitlements").notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creditscoreSubscriptions = pgTable(
  "creditscore_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — anonymous one-time report purchasers have no company yet.
    companyId: uuid("company_id"),
    email: text("email"),
    domain: text("domain"),
    planId: uuid("plan_id")
      .notNull()
      .references(() => creditscorePlans.id),
    // Denormalized for easy querying / entitlement resolution.
    tier: text("tier").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    // status: pending | active | past_due | canceled | fulfilled (one-time)
    status: text("status").notNull().default("pending"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("creditscore_subscriptions_company_idx").on(table.companyId),
    emailIdx: index("creditscore_subscriptions_email_idx").on(table.email),
    domainIdx: index("creditscore_subscriptions_domain_idx").on(table.domain),
    statusIdx: index("creditscore_subscriptions_status_idx").on(table.status),
    stripeSubIdx: uniqueIndex("creditscore_subscriptions_stripe_sub_idx").on(
      table.stripeSubscriptionId,
    ),
  }),
);

export const creditscoreReports = pgTable(
  "creditscore_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id").references(() => creditscoreSubscriptions.id, {
      onDelete: "set null",
    }),
    domain: text("domain").notNull(),
    email: text("email"),
    // Raw audit microservice payload (signals + narrative + competitors).
    resultJson: jsonb("result_json").notNull().default({}),
    // Full per-page Firecrawl response for replay / re-scoring. Nullable for
    // legacy rows and for status=degraded/failed where the crawler returned
    // nothing useful. Phase 2 signal upgrades will read from this.
    rawData: jsonb("raw_data"),
    // Composite 0–100 score; nullable while status=pending or degraded.
    score: integer("score"),
    previousScore: integer("previous_score"),
    // status: pending | complete | failed | degraded
    // "degraded" means crawler returned partial/no data; score is untrustworthy
    // and consumers (mailing cron, upsells) MUST filter to status='complete'.
    status: text("status").notNull().default("pending"),
    // Public share token — null until report is complete + opted in to sharing.
    shareableSlug: text("shareable_slug"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subscriptionIdx: index("creditscore_reports_subscription_idx").on(table.subscriptionId),
    domainIdx: index("creditscore_reports_domain_idx").on(table.domain),
    statusIdx: index("creditscore_reports_status_idx").on(table.status),
    shareableSlugIdx: uniqueIndex("creditscore_reports_shareable_slug_idx").on(
      table.shareableSlug,
    ),
  }),
);
