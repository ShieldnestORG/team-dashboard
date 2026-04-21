import {
  pgTable, uuid, text, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";

export type MerchShippingAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export const merchRequests = pgTable(
  "merch_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),
    itemType: text("item_type").notNull(),
    sizeOrVariant: text("size_or_variant"),
    shippingAddress: jsonb("shipping_address").$type<MerchShippingAddress>().notNull(),
    status: text("status").notNull().default("requested"),
    trackingNumber: text("tracking_number"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    affiliateStatusIdx: index("merch_requests_affiliate_status_idx").on(t.affiliateId, t.status),
  }),
);
