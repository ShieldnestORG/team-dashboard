import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";
import { partnerCompanies } from "./partners.js";
import { referralAttribution } from "./referral_attribution.js";

export const attributionOverrides = pgTable(
  "attribution_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => partnerCompanies.id),
    previousAttributionId: uuid("previous_attribution_id").references(() => referralAttribution.id),
    newAttributionId: uuid("new_attribution_id").references(() => referralAttribution.id),
    previousAffiliateId: uuid("previous_affiliate_id").references(() => affiliates.id),
    newAffiliateId: uuid("new_affiliate_id").references(() => affiliates.id),
    overrideType: text("override_type").notNull(),
    reason: text("reason").notNull(),
    overriddenByUserId: text("overridden_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    leadIdx: index("attribution_overrides_lead_idx").on(t.leadId),
    overriddenByIdx: index("attribution_overrides_overridden_by_idx").on(t.overriddenByUserId),
  }),
);
