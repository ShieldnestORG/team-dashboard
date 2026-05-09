/**
 * One-shot Stripe → customer_accounts backfill.
 *
 * Walks every Stripe Customer (paginated, 100 per page) and matches by
 * lower-cased email to a `customer_accounts` row. If the row exists and
 * `stripe_customer_id` is NULL, sets it. If it differs, logs a warning and
 * SKIPS — that case needs human review and must not be silently overwritten.
 *
 * Why:
 *   `server/src/services/customer-account-linker.ts` only fires on NEW Stripe
 *   webhook events (checkout.session.completed, customer.created/updated).
 *   Every existing CreditScore + bundle customer in the DB right now is
 *   missing `customer_accounts.stripe_customer_id`, so when they sign in via
 *   the new portal at app.coherencedaddy.com:
 *     - GET  /api/portal/me           → bundles: []
 *     - POST /api/portal/stripe-portal → 400 ("No Stripe customer linked…")
 *
 * Usage:
 *   # Dry-run (default — prints proposed actions, no writes):
 *   npx tsx scripts/backfill-stripe-customer-id.ts
 *
 *   # Apply (writes to the DB):
 *   npx tsx scripts/backfill-stripe-customer-id.ts --apply
 *
 * Env:
 *   DATABASE_URL       (required) — Postgres connection
 *   STRIPE_SECRET_KEY  (required) — same key the cron jobs use
 *
 * Properties:
 *   - Idempotent: safe to re-run. Subsequent runs see `already-set` for rows
 *     populated on the previous run.
 *   - Conservative: never overwrites an existing differing stripe_customer_id;
 *     surfaces those as `mismatch-skip` warnings for human review.
 *   - Email matching mirrors `customer-account-linker.ts` exactly: trim +
 *     toLowerCase, citext-safe via `LOWER(email) = LOWER($1)` predicates.
 */

import { createDb, sql, type Db } from "@paperclipai/db";
import { stripeRequest, stripeConfigured } from "../server/src/services/stripe-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StripeCustomer {
  id: string;
  email: string | null;
}

interface StripeCustomerListResponse {
  data: StripeCustomer[];
  has_more: boolean;
}

export type BackfillAction =
  | "set" // wrote stripe_customer_id where it was NULL
  | "already-set" // row already has the same stripe_customer_id (noop)
  | "mismatch-skip" // row has a DIFFERENT stripe_customer_id — needs human review
  | "no-account" // no customer_accounts row matches this email
  | "no-email"; // Stripe customer has no email — cannot match

export interface BackfillRecord {
  email: string | null;
  stripeCustomerId: string;
  action: BackfillAction;
  // When action === 'mismatch-skip', the value already in the DB.
  existingStripeCustomerId?: string;
  // When action === 'set' or 'already-set', the matched account id.
  accountId?: string;
}

export interface BackfillCounts {
  scanned: number;
  matched: number; // scanned where an account row matched on email
  set: number;
  alreadySet: number;
  mismatchSkipped: number;
  noAccount: number;
  noEmail: number;
}

export interface BackfillOptions {
  apply: boolean;
  // Optional cap for tests / smoke runs. Production: leave undefined.
  maxCustomers?: number;
}

// ---------------------------------------------------------------------------
// DB shape we depend on. Narrow to what we actually call so unit tests can
// supply a tiny mock without standing up a real Drizzle/Postgres handle.
// ---------------------------------------------------------------------------

export interface BackfillDb {
  execute: Db["execute"];
}

// ---------------------------------------------------------------------------
// Stripe pagination iterator. Yields one customer at a time so processing
// can interleave with HTTP fetches without buffering everything in memory.
// ---------------------------------------------------------------------------

export type StripeListFn = (params: {
  limit: number;
  starting_after?: string;
}) => Promise<StripeCustomerListResponse>;

const defaultStripeListFn: StripeListFn = async (params) => {
  // Stripe REST: GET /v1/customers?limit=100[&starting_after=cus_…]
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit));
  if (params.starting_after) qs.set("starting_after", params.starting_after);
  return stripeRequest<StripeCustomerListResponse>("GET", `/customers?${qs.toString()}`);
};

export async function* paginateStripeCustomers(
  list: StripeListFn = defaultStripeListFn,
  pageSize = 100,
): AsyncGenerator<StripeCustomer> {
  let startingAfter: string | undefined;
  while (true) {
    const page = await list({ limit: pageSize, starting_after: startingAfter });
    for (const c of page.data) yield c;
    if (!page.has_more || page.data.length === 0) return;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) return;
  }
}

// ---------------------------------------------------------------------------
// Per-customer match + (optionally) write.
//
// Matching mirrors customer-account-linker.ts exactly:
//   - trim + toLowerCase the email
//   - lookup via `LOWER(email) = $1` so it works against both citext (prod)
//     and plain text (test fixtures without the citext extension).
//
// Conflict policy (the load-bearing part of this whole script):
//   - account.stripe_customer_id IS NULL          → set it (write in --apply)
//   - account.stripe_customer_id === incoming     → already-set (noop)
//   - account.stripe_customer_id !== incoming     → mismatch-skip (warn)
//
// Never overwrites an existing differing value. That case means either:
//   (a) the customer made two separate Stripe purchases on different emails
//       that later got merged on our side, or
//   (b) Stripe has duplicate customer rows for one human (which happens when
//       checkout is created without a `customer` arg).
// Either way: human review, not a silent overwrite.
// ---------------------------------------------------------------------------

export async function processCustomer(
  db: BackfillDb,
  customer: StripeCustomer,
  opts: { apply: boolean },
): Promise<BackfillRecord> {
  const stripeCustomerId = customer.id;
  const email = customer.email?.trim().toLowerCase() ?? "";

  if (!email) {
    return { email: null, stripeCustomerId, action: "no-email" };
  }

  const existing = (await db.execute(sql`
    SELECT id, stripe_customer_id
    FROM customer_accounts
    WHERE LOWER(email) = ${email}
    LIMIT 1
  `)) as unknown as Array<{ id: string; stripe_customer_id: string | null }>;

  const row = existing[0];
  if (!row) {
    return { email, stripeCustomerId, action: "no-account" };
  }

  if (row.stripe_customer_id === stripeCustomerId) {
    return {
      email,
      stripeCustomerId,
      action: "already-set",
      accountId: row.id,
    };
  }

  if (row.stripe_customer_id && row.stripe_customer_id !== stripeCustomerId) {
    return {
      email,
      stripeCustomerId,
      action: "mismatch-skip",
      existingStripeCustomerId: row.stripe_customer_id,
      accountId: row.id,
    };
  }

  // row.stripe_customer_id is NULL → safe to set.
  if (opts.apply) {
    await db.execute(sql`
      UPDATE customer_accounts
      SET stripe_customer_id = ${stripeCustomerId}
      WHERE id = ${row.id}
        AND stripe_customer_id IS NULL
    `);
  }

  return { email, stripeCustomerId, action: "set", accountId: row.id };
}

// ---------------------------------------------------------------------------
// Top-level orchestration. Pulls every Stripe customer, runs processCustomer
// on each, accumulates counts, and emits a JSON log line per record.
// ---------------------------------------------------------------------------

export interface BackfillResult {
  counts: BackfillCounts;
  records: BackfillRecord[];
}

export async function runBackfill(
  db: BackfillDb,
  opts: BackfillOptions,
  list: StripeListFn = defaultStripeListFn,
  log: (record: BackfillRecord) => void = defaultLogger,
): Promise<BackfillResult> {
  const counts: BackfillCounts = {
    scanned: 0,
    matched: 0,
    set: 0,
    alreadySet: 0,
    mismatchSkipped: 0,
    noAccount: 0,
    noEmail: 0,
  };
  const records: BackfillRecord[] = [];

  for await (const customer of paginateStripeCustomers(list)) {
    counts.scanned += 1;
    const record = await processCustomer(db, customer, { apply: opts.apply });
    records.push(record);
    log(record);

    switch (record.action) {
      case "set":
        counts.set += 1;
        counts.matched += 1;
        break;
      case "already-set":
        counts.alreadySet += 1;
        counts.matched += 1;
        break;
      case "mismatch-skip":
        counts.mismatchSkipped += 1;
        counts.matched += 1;
        break;
      case "no-account":
        counts.noAccount += 1;
        break;
      case "no-email":
        counts.noEmail += 1;
        break;
    }

    if (opts.maxCustomers && counts.scanned >= opts.maxCustomers) break;
  }

  return { counts, records };
}

function defaultLogger(record: BackfillRecord): void {
  // One JSON line per Stripe customer scanned. Easy to grep and pipe to jq.
  // Suppress no-account / no-email rows in the default logger to keep output
  // readable on large Stripe accounts (most customers won't have a portal
  // row yet) — the counts at the end still capture them.
  if (record.action === "no-account" || record.action === "no-email") return;
  // eslint-disable-next-line no-console -- this is a CLI script
  console.log(JSON.stringify(record));
}

// ---------------------------------------------------------------------------
// CLI entry point. Mirrors the style of scripts/migrate-inline-env-secrets.ts
// (--apply flag, env-var checks, exits non-zero on failure).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!stripeConfigured()) {
    console.error("STRIPE_SECRET_KEY is required");
    process.exit(1);
  }

  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)";
  console.error(`backfill-stripe-customer-id: starting in ${mode}`);

  const db = createDb(dbUrl);
  const { counts } = await runBackfill(db, { apply });

  console.error("");
  console.error("backfill-stripe-customer-id: summary");
  console.error(`  mode:             ${mode}`);
  console.error(`  scanned:          ${counts.scanned}`);
  console.error(`  matched account:  ${counts.matched}`);
  console.error(`  set:              ${counts.set}`);
  console.error(`  already-set:      ${counts.alreadySet}`);
  console.error(`  mismatch-skip:    ${counts.mismatchSkipped}`);
  console.error(`  no-account:       ${counts.noAccount}`);
  console.error(`  no-email:         ${counts.noEmail}`);
  if (!apply && counts.set > 0) {
    console.error("");
    console.error(
      `Re-run with --apply to write ${counts.set} stripe_customer_id value(s).`,
    );
  }
  if (counts.mismatchSkipped > 0) {
    console.error("");
    console.error(
      `WARNING: ${counts.mismatchSkipped} account(s) already have a DIFFERENT stripe_customer_id.`,
    );
    console.error(
      "  These were SKIPPED to avoid clobbering linker writes. Inspect the",
    );
    console.error(
      "  'mismatch-skip' log lines above and reconcile manually if needed.",
    );
  }
}

// Only run main() when executed directly, not when imported by tests.
// import.meta.url is a file:// URL; argv[1] is an absolute path. Compare safely.
const isDirectRun = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return import.meta.url === new URL(`file://${entry}`).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error("backfill-stripe-customer-id: failed", err);
    process.exit(1);
  });
}
