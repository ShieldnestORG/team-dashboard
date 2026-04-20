import {
  pgTable, uuid, text, timestamp, integer, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),

    amountCents: integer("amount_cents").notNull(),
    commissionCount: integer("commission_count").notNull(),

    method: text("method").notNull().default("manual_ach"),
    externalId: text("external_id"),

    status: text("status").notNull().default("scheduled"),

    batchMonth: text("batch_month").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    affiliateBatchUq: uniqueIndex("payouts_affiliate_batch_uq").on(t.affiliateId, t.batchMonth),
    statusIdx: index("payouts_status_idx").on(t.status),
    scheduledForIdx: index("payouts_scheduled_for_idx").on(t.scheduledFor),
  }),
);
