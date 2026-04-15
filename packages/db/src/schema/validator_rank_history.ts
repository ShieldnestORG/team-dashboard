import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const validatorRankHistory = pgTable(
  "validator_rank_history",
  {
    id: serial("id").primaryKey(),
    network: text("network").notNull(),
    moniker: text("moniker").notNull(),
    rank: integer("rank").notNull(),
    votingPower: numeric("voting_power"),
    commission: numeric("commission"),
    uptimePct: numeric("uptime_pct"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lookupIdx: index("idx_validator_rank_history_lookup").on(
      table.network,
      table.moniker,
      table.capturedAt,
    ),
    networkTimeIdx: index("idx_validator_rank_history_network_time").on(
      table.network,
      table.capturedAt,
    ),
  }),
);
