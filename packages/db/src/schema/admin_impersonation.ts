import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Admin → customer impersonation (migration 0116).
//
// Only the SHORT-LIVED single-use nonce lives here. The longer-lived
// impersonation session itself is an HMAC-signed cookie (no row) — see
// `server/src/services/admin-impersonation.ts`.
// ---------------------------------------------------------------------------

export const adminImpersonationNonces = pgTable(
  "admin_impersonation_nonces",
  {
    nonce: text("nonce").primaryKey(),
    adminActorId: uuid("admin_actor_id").notNull(),
    adminActorLabel: text("admin_actor_label"),
    targetAccountId: uuid("target_account_id").notNull(),
    targetCustomerLabel: text("target_customer_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    burnedAt: timestamp("burned_at", { withTimezone: true }),
  },
  (t) => ({
    expiresIdx: index("admin_impersonation_nonces_expires_idx").on(t.expiresAt),
    targetIdx: index("admin_impersonation_nonces_target_idx").on(
      t.targetAccountId,
    ),
  }),
);

export type AdminImpersonationNonce = typeof adminImpersonationNonces.$inferSelect;
export type NewAdminImpersonationNonce =
  typeof adminImpersonationNonces.$inferInsert;
