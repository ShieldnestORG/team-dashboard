import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Success-path API usage/cost meter (Phase 2 of provider observability; the
// failure side is alert_events via noteProviderFailure). One row per
// successful provider call, written fire-and-forget by the server's
// logApiUsage(). Tokens are always faithful; cost_usd is 0 unless the model
// has a verified price. Community agents are excluded — they have their own
// ledger (university_agent_usage).
export const apiUsageEvents = pgTable(
  "api_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    service: text("service").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // numeric => string in the ORM; correct for a money ledger.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdIdx: index("api_usage_events_created_idx").on(table.createdAt),
    providerCreatedIdx: index("api_usage_events_provider_created_idx").on(
      table.provider,
      table.createdAt,
    ),
  }),
);
