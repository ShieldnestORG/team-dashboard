import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { intelCompanies } from "./intel_companies.js";

export const directoryListings = pgTable(
  "directory_listings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => intelCompanies.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    status: text("status").notNull().default("prospect"),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePriceId: text("stripe_price_id"),
    checkoutUrl: text("checkout_url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    lastOutreachAt: timestamp("last_outreach_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("directory_listings_company_idx").on(table.companyId),
    statusIdx: index("directory_listings_status_idx").on(table.status),
  }),
);

export const directoryListingEvents = pgTable(
  "directory_listing_events",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id").references(() => directoryListings.id, {
      onDelete: "cascade",
    }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    listingIdx: index("directory_listing_events_listing_idx").on(table.listingId),
  }),
);
