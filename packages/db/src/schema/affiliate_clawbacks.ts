import {
  pgTable, uuid, text, timestamp, integer, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";
import { commissions } from "./commissions.js";

// First-class recovery obligation for a commission whose money was already
// disbursed when it was clawed back. The outstanding balance per affiliate is
// SUM(origin_amount_cents - recovered_cents) over rows still 'open'/'recovering',
// and is netted against future payouts at mark-sent time. See migration 0121 and
// services/clawback.ts.
export const affiliateClawbacks = pgTable(
  "affiliate_clawbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),

    // The disbursed commission being recovered. One clawback per commission.
    sourceCommissionId: uuid("source_commission_id").notNull().references(() => commissions.id),

    originAmountCents: integer("origin_amount_cents").notNull(),
    recoveredCents: integer("recovered_cents").notNull().default(0),

    // open | recovering | recovered | written_off
    status: text("status").notNull().default("open"),

    // stripe_refund | compliance_violation | admin_manual
    reason: text("reason").notNull(),

    windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }).notNull(),

    // Board actor for manual clawbacks; null for automated paths.
    createdByUserId: uuid("created_by_user_id"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceCommissionUq: uniqueIndex("affiliate_clawbacks_source_commission_uq").on(t.sourceCommissionId),
    affiliateStatusIdx: index("affiliate_clawbacks_affiliate_status_idx").on(t.affiliateId, t.status),
    windowIdx: index("affiliate_clawbacks_window_idx").on(t.windowExpiresAt),
  }),
);
