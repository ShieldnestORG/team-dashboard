import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, timestamp, integer, numeric, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";
import { partnerCompanies } from "./partners.js";
import { referralAttribution } from "./referral_attribution.js";
import { payouts } from "./payouts.js";

export const commissions = pgTable(
  "commissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),
    leadId: uuid("lead_id").notNull().references(() => partnerCompanies.id),
    attributionId: uuid("attribution_id").notNull().references(() => referralAttribution.id),

    type: text("type").notNull(),

    rate: numeric("rate", { precision: 5, scale: 4 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    basisCents: integer("basis_cents").notNull(),

    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    status: text("status").notNull().default("pending_activation"),

    stripeInvoiceId: text("stripe_invoice_id"),
    stripeChargeId: text("stripe_charge_id"),

    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    payoutBatchId: uuid("payout_batch_id").references(() => payouts.id),
    clawbackReason: text("clawback_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    affiliateStatusIdx: index("commissions_affiliate_status_idx").on(t.affiliateId, t.status),
    leadIdx: index("commissions_lead_idx").on(t.leadId),
    stripeInvoiceUq: uniqueIndex("commissions_stripe_invoice_uq")
      .on(t.stripeInvoiceId)
      .where(sql`stripe_invoice_id IS NOT NULL`),
    holdExpiresIdx: index("commissions_hold_expires_idx")
      .on(t.holdExpiresAt)
      .where(sql`status = 'pending_activation'`),
    payoutBatchIdx: index("commissions_payout_batch_idx").on(t.payoutBatchId),
  }),
);
