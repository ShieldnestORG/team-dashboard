import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
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
  // Indexes idx_validator_rank_history_lookup / _network_time dropped 2026-06-10:
  // the table is write-only (inserted by cosmos-lcd.ts, never read), so both
  // secondary indexes had 0 lifetime scans and only added write overhead.
);
