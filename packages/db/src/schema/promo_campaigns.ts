import {
  pgTable, uuid, text, timestamp, index,
} from "drizzle-orm/pg-core";

export const promoCampaigns = pgTable(
  "promo_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    hashtag: text("hashtag"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    giveawayPrize: text("giveaway_prize"),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("promo_campaigns_status_idx").on(t.status),
  }),
);
