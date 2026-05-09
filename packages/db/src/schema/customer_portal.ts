import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Customer Portal MVP schema (migration 0107).
//
// `email` is citext in the DB. Drizzle has no native citext column type, so we
// declare it as `text` here — Postgres still enforces case-insensitive
// uniqueness via the underlying citext type. Always lowercase emails before
// comparison in TS to keep behaviour predictable when running against Postgres
// fixtures that don't have the citext extension installed.
// ---------------------------------------------------------------------------

export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => ({
    emailUq: uniqueIndex("customer_accounts_email_key").on(t.email),
    stripeCustomerIdx: index("customer_accounts_stripe_customer_idx").on(
      t.stripeCustomerId,
    ),
  }),
);

export const customerMagicLinks = pgTable(
  "customer_magic_links",
  {
    token: text("token").primaryKey(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailExpiresIdx: index("customer_magic_links_email_expires_idx").on(
      t.email,
      t.expiresAt,
    ),
    consumedIdx: index("customer_magic_links_consumed_idx").on(t.consumedAt),
  }),
);

export const customerCredentials = pgTable(
  "customer_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    // Enforced at the DB level via CHECK constraint — see migration 0107.
    // Allowed: cloudflare_api_token | reddit_oauth | x_oauth | ga4_property
    kind: text("kind").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    accountIdx: index("customer_credentials_account_idx").on(t.accountId),
    activeUq: uniqueIndex("customer_credentials_active_uq")
      .on(t.accountId, t.kind)
      .where(sql`${t.revokedAt} IS NULL`),
  }),
);

export const customerActionLog = pgTable(
  "customer_action_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountCreatedIdx: index("customer_action_log_account_created_idx").on(
      t.accountId,
      t.createdAt,
    ),
    kindIdx: index("customer_action_log_kind_idx").on(t.kind),
  }),
);

export type CustomerCredentialKind =
  | "cloudflare_api_token"
  | "reddit_oauth"
  | "x_oauth"
  | "ga4_property";

export const CUSTOMER_CREDENTIAL_KINDS: readonly CustomerCredentialKind[] = [
  "cloudflare_api_token",
  "reddit_oauth",
  "x_oauth",
  "ga4_property",
];
