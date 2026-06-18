import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { customerAccounts } from "./customer_portal.js";

// ---------------------------------------------------------------------------
// Coherent Ones University — $50/mo recurring membership.
//
// A University member is its OWN member class, not merely an access flag
// bolted onto an existing customer/affiliate account. We model it as a real
// member entity (`university_members`) while REUSING the existing magic-link
// auth — `customer_accounts` is the shared login identity, joined on the
// lowercased `email` (or `account_id` once the customer-account-linker has
// fired) — and the existing Stripe pipeline.
//
// Two tables:
//   - university_members        — the member entity / profile (the join key
//                                 is the lowercased `email`).
//   - university_subscriptions  — the Stripe billing record. Idempotency key
//                                 is `stripe_subscription_id` (UNIQUE).
//
// The Stripe webhook handler (services/university-stripe-handler.ts) upserts
// both on `checkout.session.completed`; `customer.subscription.updated` /
// `customer.subscription.deleted` mirror status onto both rows. Mirrors the
// single-tier $X/mo Watchtower template — see schema/watchtower.ts.
// ---------------------------------------------------------------------------

export const universityMembers = pgTable(
  "university_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `email` is the durable join key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The join key. Lowercased before insert — unique across members.
    email: text("email").notNull(),
    displayName: text("display_name"),
    // pending | active | past_due | cancelled
    status: text("status").notNull().default("pending"),
    // Stable plan key — currently single-tier 'university_monthly'.
    plan: text("plan").notNull().default("university_monthly"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailUq: uniqueIndex("university_members_email_key").on(table.email),
    accountIdx: index("university_members_account_idx").on(table.accountId),
    statusIdx: index("university_members_status_idx").on(table.status),
  }),
);

export const universitySubscriptions = pgTable(
  "university_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The member this billing record provisions. Nullable so a checkout that
    // races ahead of member creation still records the Stripe row.
    memberId: uuid("member_id").references(() => universityMembers.id),
    // Resolved by the customer-account-linker at checkout time.
    accountId: uuid("account_id"),
    // Captured at checkout. Recipient + member join key fallback.
    email: text("email"),
    // Stable plan key — currently single-tier 'university_monthly'.
    plan: text("plan").default("university_monthly"),
    // pending | active | past_due | cancelled
    status: text("status").default("pending"),
    stripeCustomerId: text("stripe_customer_id"),
    // Idempotency key — UNIQUE. A replayed checkout updates this row in place.
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    stripeSubUq: uniqueIndex("university_subscriptions_stripe_sub_uq").on(
      table.stripeSubscriptionId,
    ),
    emailIdx: index("university_subscriptions_email_idx").on(table.email),
    stripeCustIdx: index("university_subscriptions_stripe_cust_idx").on(
      table.stripeCustomerId,
    ),
    statusIdx: index("university_subscriptions_status_idx").on(table.status),
  }),
);

export type UniversityMember = typeof universityMembers.$inferSelect;
export type NewUniversityMember = typeof universityMembers.$inferInsert;
export type UniversitySubscription =
  typeof universitySubscriptions.$inferSelect;
export type NewUniversitySubscription =
  typeof universitySubscriptions.$inferInsert;
