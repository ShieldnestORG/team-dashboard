import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { affiliates } from "./affiliates.js";

// ---------------------------------------------------------------------------
// Shop sharers — email-capture entity for shop.coherencedaddy.com.
// A "sharer" receives a referral code + QR + shareable link on email submit.
// Opting in and getting approved promotes them to an `affiliates` row.
// See docs/products/shop-sharers.md.
// ---------------------------------------------------------------------------

export const shopSharers = pgTable(
  "shop_sharers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    referralCode: text("referral_code").notNull(),
    qrObjectKey: text("qr_object_key"),
    landingPath: text("landing_path").notNull().default("/shop-home"),
    // null | 'pending' | 'approved' | 'rejected'
    affiliateApplicationStatus: text("affiliate_application_status"),
    affiliateId: uuid("affiliate_id").references(() => affiliates.id),
    sharedMarketingEligible: boolean("shared_marketing_eligible")
      .notNull()
      .default(false),
    // 'shop_hero' | 'share_page' | 'admin'
    source: text("source").notNull().default("shop_hero"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex("shop_sharers_email_uq").on(sql`LOWER(${t.email})`),
    codeUq: uniqueIndex("shop_sharers_referral_code_uq").on(t.referralCode),
    statusIdx: index("shop_sharers_status_idx").on(t.affiliateApplicationStatus),
  }),
);

export const shopReferralEvents = pgTable(
  "shop_referral_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sharerId: uuid("sharer_id")
      .notNull()
      .references(() => shopSharers.id, { onDelete: "cascade" }),
    referralCode: text("referral_code").notNull(),
    // 'hit' | 'purchase' (future)
    eventType: text("event_type").notNull(),
    path: text("path"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    amountCents: integer("amount_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sharerIdx: index("shop_referral_events_sharer_idx").on(t.sharerId),
    codeCreatedIdx: index("shop_referral_events_code_created_idx").on(
      t.referralCode,
      t.createdAt,
    ),
    typeIdx: index("shop_referral_events_type_idx").on(t.eventType),
  }),
);
