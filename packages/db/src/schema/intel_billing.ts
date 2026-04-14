import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const intelPlans = pgTable("intel_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  stripePriceId: text("stripe_price_id"),
  stripeMeteredPriceId: text("stripe_metered_price_id"),
  monthlyRequestQuota: bigint("monthly_request_quota", { mode: "number" }).notNull().default(0),
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(60),
  overagePriceCentsPer1k: integer("overage_price_cents_per_1k").notNull().default(0),
  priceCents: integer("price_cents").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const intelCustomers = pgTable(
  "intel_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    planId: uuid("plan_id").references(() => intelPlans.id),
    status: text("status").notNull().default("active"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stripeCustomerIdx: index("idx_intel_customers_stripe_customer").on(table.stripeCustomerId),
  }),
);

export const intelApiKeys = pgTable(
  "intel_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => intelCustomers.id, { onDelete: "cascade" }),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    name: text("name").notNull().default("default"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    customerIdx: index("idx_intel_api_keys_customer").on(table.customerId),
  }),
);

export const intelUsageMeter = pgTable(
  "intel_usage_meter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => intelApiKeys.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
    overageCount: bigint("overage_count", { mode: "number" }).notNull().default(0),
    overageUnitsReported: bigint("overage_units_reported", { mode: "number" }).notNull().default(0),
    overageReportedToStripeAt: timestamp("overage_reported_to_stripe_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyPeriodIdx: uniqueIndex("idx_intel_usage_meter_key_period").on(
      table.apiKeyId,
      table.periodStart,
    ),
  }),
);
