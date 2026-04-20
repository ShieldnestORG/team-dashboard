import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, timestamp, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";
import { partnerCompanies } from "./partners.js";

export const referralAttribution = pgTable(
  "referral_attribution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => partnerCompanies.id, { onDelete: "cascade" }),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),

    attributionType: text("attribution_type").notNull().default("affiliate_referred_cd_closed"),

    lockStartAt: timestamp("lock_start_at", { withTimezone: true }).notNull().defaultNow(),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }).notNull(),
    lockReleasedAt: timestamp("lock_released_at", { withTimezone: true }),

    firstTouchLogged: boolean("first_touch_logged").notNull().default(false),
    firstTouchType: text("first_touch_type"),
    firstTouchDate: timestamp("first_touch_date", { withTimezone: true }),
    firstTouchNotes: text("first_touch_notes"),
    relationshipWarmth: text("relationship_warmth"),

    affiliateClosePreference: text("affiliate_close_preference"),

    adminOverride: boolean("admin_override").notNull().default(false),
    overrideReason: text("override_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeLeadUq: uniqueIndex("referral_attribution_active_lead_uq")
      .on(t.leadId)
      .where(sql`lock_released_at IS NULL`),
    affiliateIdx: index("referral_attribution_affiliate_idx").on(t.affiliateId),
    lockExpiresIdx: index("referral_attribution_lock_expires_idx").on(t.lockExpiresAt),
  }),
);
