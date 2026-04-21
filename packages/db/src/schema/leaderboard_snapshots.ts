import {
  pgTable, uuid, text, timestamp, integer, numeric, index,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    period: text("period").notNull(),
    rank: integer("rank").notNull(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),
    score: numeric("score", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    periodRankIdx: index("leaderboard_snapshots_period_rank_idx").on(t.period, t.rank),
    affiliateIdx: index("leaderboard_snapshots_affiliate_idx").on(t.affiliateId),
  }),
);
