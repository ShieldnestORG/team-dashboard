import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const pulseXrplBridge = pgTable(
  "pulse_xrpl_bridge_mentions",
  {
    id: serial("id").primaryKey(),
    tweetId: text("tweet_id").notNull(),
    bridgeType: text("bridge_type").notNull(), // 'xrpl-to-tx' | 'tx-to-xrpl' | 'general-bridge'
    tokenMentioned: text("token_mentioned").notNull(), // 'XRP' | 'TX' | 'other'
    stakingMentioned: boolean("staking_mentioned").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bridgeTypeIdx: index("pulse_xrpl_bridge_type_idx").on(table.bridgeType),
    capturedAtIdx: index("pulse_xrpl_bridge_captured_idx").on(table.capturedAt),
  }),
);
