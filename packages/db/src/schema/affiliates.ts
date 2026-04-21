import {
  pgTable, uuid, text, timestamp, numeric, integer, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";

export const affiliates = pgTable(
  "affiliates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("pending"),
    commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).notNull().default("0.10"),
    totalEarned: numeric("total_earned", { precision: 12, scale: 2 }).notNull().default("0"),
    policyAcceptedAt: timestamp("policy_accepted_at", { withTimezone: true }),
    payoutMethod: text("payout_method"),
    payoutAccount: text("payout_account"),
    minimumPayoutCents: integer("minimum_payout_cents").notNull().default(5000),
    resetToken: text("reset_token"),
    resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
    tier: text("tier").notNull().default("bronze"),
    tierUpgradedAt: timestamp("tier_upgraded_at", { withTimezone: true }),
    violationCount: integer("violation_count").notNull().default(0),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspensionReason: text("suspension_reason"),
    promoOptIn: boolean("promo_opt_in").notNull().default(false),
    lastLeadSubmittedAt: timestamp("last_lead_submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex("affiliates_email_uq").on(t.email),
    statusIdx: index("affiliates_status_idx").on(t.status),
    tierIdx: index("affiliates_tier_idx").on(t.tier),
    suspendedIdx: index("affiliates_suspended_idx").on(t.suspendedAt),
  }),
);
