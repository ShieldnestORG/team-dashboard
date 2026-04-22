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
// Bundle product definitions — rows seeded at deploy time.
// ---------------------------------------------------------------------------

export const bundlePlans = pgTable("bundle_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  annualPriceCents: integer("annual_price_cents").notNull(),
  stripePriceId: text("stripe_price_id"),
  stripeAnnualPriceId: text("stripe_annual_price_id"),
  // JSON entitlement map — see bundles-prd.md for schema.
  entitlements: jsonb("entitlements").notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Per-company bundle subscriptions.
// ---------------------------------------------------------------------------

export const bundleSubscriptions = pgTable(
  "bundle_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    bundlePlanId: uuid("bundle_plan_id")
      .notNull()
      .references(() => bundlePlans.id),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    billingInterval: text("billing_interval").notNull().default("monthly"), // "monthly" | "annual"
    status: text("status").notNull().default("pending"), // pending | active | past_due | canceled
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("bundle_subscriptions_company_idx").on(table.companyId),
    stripeSubIdx: uniqueIndex("bundle_subscriptions_stripe_sub_idx").on(table.stripeSubscriptionId),
  }),
);
