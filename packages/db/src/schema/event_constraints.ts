import { pgTable, uuid, text, timestamp, jsonb, integer, boolean, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const eventConstraints = pgTable(
  "event_constraints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    kind: text("kind").notNull(),
    pattern: jsonb("pattern").$type<EventConstraintPattern>().notNull(),
    maxLagMs: integer("max_lag_ms").notNull().default(60000),
    enabled: boolean("enabled").notNull().default(true),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastViolationAt: timestamp("last_violation_at", { withTimezone: true }),
    violationCount: integer("violation_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    enabledIdx: index("event_constraints_enabled_idx").on(table.enabled),
  }),
);

export interface EventConstraintPattern {
  // "every event of `of` must be followed by an event of `require` that has
  // `of`'s id in its caused_by, within max_lag_ms."
  of: string;
  require: string;
}
