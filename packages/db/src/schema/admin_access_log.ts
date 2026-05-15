import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// admin_access_log — OPS TELEMETRY audit trail for authenticated admin route
// hits. Sibling to `activity_log`; the split is load-bearing:
//
//   activity_log       — COMPLIANCE. Customer-visible (GDPR export),
//                        indefinite retention, business-material events
//                        only, written by domain services.
//
//   admin_access_log   — OPS TELEMETRY. Admin-internal, NOT in customer
//                        GDPR export, 90-day retention, written by route
//                        middleware on every authenticated admin hit
//                        (including unauth 401s).
//
// Do not collapse the two: compliance retention is forever, ops retention is
// short and high-volume. Migration 0113_admin_access_log.sql carries the same
// rationale in plain SQL.
//
// `actor_id` is nullable + UUID-typed but unconstrained (no FK). We log
// unauth attempts (`actor_type='none'`, status 401) and the existing
// in-process actor union mixes UUID user ids with synthetic non-UUID ids
// (e.g. 'local-board'); the middleware coerces non-UUID ids to null on
// write so the column stays clean for indexing.
// ---------------------------------------------------------------------------

export const adminAccessLog = pgTable(
  "admin_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    actorType: text("actor_type"),
    actorLabel: text("actor_label"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    requestSummary: jsonb("request_summary").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    actorIdx: index("admin_access_log_actor_idx").on(
      table.actorId,
      table.createdAt,
    ),
    pathIdx: index("admin_access_log_path_idx").on(table.path, table.createdAt),
  }),
);

export type AdminAccessLogRow = typeof adminAccessLog.$inferSelect;
export type NewAdminAccessLogRow = typeof adminAccessLog.$inferInsert;
