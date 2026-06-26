import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// trends_digests — the "what's hot" feed's persisted output, one row per run
// date (migration 0138). A digest is `pending` until a human approves it
// (Rule 7). `payload` is the full TrendDigest (typed in the server package, so
// kept opaque here to avoid a server→db type dependency). `ad_friendly_ids`
// is the ✅-only subset cleared for paid-ad copy (Rule 5).
// ---------------------------------------------------------------------------

export const trendsDigests = pgTable(
  "trends_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    digestDate: text("digest_date").notNull(), // YYYY-MM-DD
    status: text("status").notNull().default("pending"), // pending | approved | sent | rejected
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    adFriendlyIds: jsonb("ad_friendly_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    dateUq: uniqueIndex("trends_digests_date_key").on(table.digestDate),
    statusIdx: index("trends_digests_status_idx").on(
      table.status,
      table.digestDate,
    ),
  }),
);

export type TrendsDigestRow = typeof trendsDigests.$inferSelect;
export type NewTrendsDigestRow = typeof trendsDigests.$inferInsert;
