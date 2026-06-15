import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { shopSharers, shopReferralEvents } from "./shop_sharers.js";

// ---------------------------------------------------------------------------
// Shop commissions — lightweight payout ledger for shop/influencer referral
// sales. Deliberately separate from the B2B affiliate commission engine
// (commissions/payouts). Rows are created from paid WooCommerce orders that
// carry a ?ref= attribution, reported to POST /api/shop/woo/order.
// See docs/products/affiliate-unified-links.md (Phase 3).
// ---------------------------------------------------------------------------

export const shopCommissions = pgTable(
  "shop_commissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sharerId: uuid("sharer_id")
      .notNull()
      .references(() => shopSharers.id, { onDelete: "cascade" }),
    referralCode: text("referral_code").notNull(),
    referralEventId: uuid("referral_event_id").references(
      () => shopReferralEvents.id,
      { onDelete: "set null" },
    ),
    // External (WooCommerce) order id — idempotency key for re-delivered hooks.
    orderRef: text("order_ref").notNull(),
    grossAmountCents: integer("gross_amount_cents").notNull(),
    rate: numeric("rate", { precision: 5, scale: 4 }).notNull(),
    commissionCents: integer("commission_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    // pending | approved | paid | void
    status: text("status").notNull().default("pending"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderRefUq: uniqueIndex("shop_commissions_order_ref_uq").on(t.orderRef),
    sharerIdx: index("shop_commissions_sharer_idx").on(t.sharerId),
    statusIdx: index("shop_commissions_status_idx").on(t.status),
  }),
);
