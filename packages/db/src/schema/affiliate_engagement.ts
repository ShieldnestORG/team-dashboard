import {
  pgTable, uuid, text, timestamp, integer, boolean, index,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";
import { promoCampaigns } from "./promo_campaigns.js";

export const affiliateEngagement = pgTable(
  "affiliate_engagement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),
    campaignId: uuid("campaign_id").references(() => promoCampaigns.id),
    kind: text("kind").notNull(),
    postUrl: text("post_url"),
    hashtagUsed: text("hashtag_used"),
    score: integer("score").notNull().default(0),
    giveawayEligible: boolean("giveaway_eligible").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    affiliateOccurredIdx: index("affiliate_engagement_affiliate_occurred_idx").on(t.affiliateId, t.occurredAt),
    kindIdx: index("affiliate_engagement_kind_idx").on(t.kind),
    campaignIdx: index("affiliate_engagement_campaign_idx").on(t.campaignId),
  }),
);
