import { describe, it, expect, vi } from "vitest";
import {
  processCustomer,
  paginateStripeCustomers,
  runBackfill,
  type StripeCustomer,
  type StripeListFn,
} from "../../../scripts/backfill-stripe-customer-id.js";

// ---------------------------------------------------------------------------
// Tests for the Stripe → customer_accounts backfill script.
//
// We mock both the DB (via `db.execute`) and the Stripe pagination function.
// The shape of `db.execute` mirrors the linker tests in
// customer-account-linker.test.ts: a vi.fn() that returns an array of rows.
// ---------------------------------------------------------------------------

interface MockDbOptions {
  // Sequential return values for `execute`. Each select is one entry; each
  // update is one entry (tests can supply []).
  responses: Array<Array<Record<string, unknown>>>;
}

function makeDb(opts: MockDbOptions) {
  let i = 0;
  const execute = vi.fn(async (_q: unknown) => {
    const r = opts.responses[i] ?? [];
    i += 1;
    return r;
  });
  return { execute };
}

describe("processCustomer", () => {
  it("sets stripe_customer_id when account row exists with NULL", async () => {
    const db = makeDb({
      responses: [
        // SELECT lookup
        [{ id: "acc-1", stripe_customer_id: null }],
        // UPDATE (returns no rows; we don't read the result)
        [],
      ],
    });

    const customer: StripeCustomer = {
      id: "cus_NEW",
      email: "alice@example.com",
    };
    const record = await processCustomer(db as never, customer, { apply: true });

    expect(record.action).toBe("set");
    expect(record.accountId).toBe("acc-1");
    expect(record.stripeCustomerId).toBe("cus_NEW");
    expect(record.email).toBe("alice@example.com");
    // 1 SELECT + 1 UPDATE = 2 calls when applying.
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("does NOT write in dry-run, but still reports action=set", async () => {
    const db = makeDb({
      responses: [[{ id: "acc-2", stripe_customer_id: null }]],
    });
    const customer: StripeCustomer = {
      id: "cus_DRY",
      email: "dry@example.com",
    };

    const record = await processCustomer(db as never, customer, { apply: false });

    expect(record.action).toBe("set");
    expect(record.accountId).toBe("acc-2");
    // Only 1 SELECT — no UPDATE issued in dry-run.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("returns already-set when stripe_customer_id matches incoming", async () => {
    const db = makeDb({
      responses: [[{ id: "acc-3", stripe_customer_id: "cus_SAME" }]],
    });
    const record = await processCustomer(
      db as never,
      { id: "cus_SAME", email: "same@example.com" },
      { apply: true },
    );

    expect(record.action).toBe("already-set");
    expect(record.accountId).toBe("acc-3");
    // No UPDATE needed.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("returns mismatch-skip and does NOT write when stripe_customer_id differs", async () => {
    const db = makeDb({
      responses: [[{ id: "acc-4", stripe_customer_id: "cus_OLD" }]],
    });
    const record = await processCustomer(
      db as never,
      { id: "cus_NEW_DIFFERENT", email: "shared@example.com" },
      { apply: true },
    );

    expect(record.action).toBe("mismatch-skip");
    expect(record.existingStripeCustomerId).toBe("cus_OLD");
    expect(record.stripeCustomerId).toBe("cus_NEW_DIFFERENT");
    expect(record.accountId).toBe("acc-4");
    // No UPDATE issued — mismatch is the safety case.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("returns no-account when no customer_accounts row matches the email", async () => {
    const db = makeDb({ responses: [[]] });
    const record = await processCustomer(
      db as never,
      { id: "cus_LONELY", email: "ghost@example.com" },
      { apply: true },
    );

    expect(record.action).toBe("no-account");
    expect(record.email).toBe("ghost@example.com");
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("returns no-email when Stripe customer has null email", async () => {
    const db = makeDb({ responses: [] });
    const record = await processCustomer(
      db as never,
      { id: "cus_NOEMAIL", email: null },
      { apply: true },
    );

    expect(record.action).toBe("no-email");
    expect(record.email).toBeNull();
    // No DB calls when email is missing — short-circuit.
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("normalises email casing and whitespace before matching (mirrors linker)", async () => {
    const db = makeDb({
      responses: [[{ id: "acc-5", stripe_customer_id: null }]],
    });
    const record = await processCustomer(
      db as never,
      { id: "cus_UPPER", email: "  ALICE@Example.COM  " },
      { apply: false },
    );

    expect(record.action).toBe("set");
    // Returned email is normalised — same shape the linker writes.
    expect(record.email).toBe("alice@example.com");
  });
});

describe("paginateStripeCustomers", () => {
  it("yields all customers across multiple pages and stops on has_more=false", async () => {
    const list: StripeListFn = vi.fn(async ({ starting_after }) => {
      if (!starting_after) {
        return {
          data: [
            { id: "cus_A", email: "a@x.com" },
            { id: "cus_B", email: "b@x.com" },
          ],
          has_more: true,
        };
      }
      if (starting_after === "cus_B") {
        return {
          data: [{ id: "cus_C", email: "c@x.com" }],
          has_more: false,
        };
      }
      return { data: [], has_more: false };
    });

    const collected: string[] = [];
    for await (const c of paginateStripeCustomers(list)) collected.push(c.id);

    expect(collected).toEqual(["cus_A", "cus_B", "cus_C"]);
    // 2 pages = 2 list calls.
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("stops cleanly when first page is empty", async () => {
    const list: StripeListFn = vi.fn(async () => ({ data: [], has_more: false }));
    const collected: string[] = [];
    for await (const c of paginateStripeCustomers(list)) collected.push(c.id);
    expect(collected).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("runBackfill (integration)", () => {
  it("counts every action type across a mixed customer list", async () => {
    // Customers in Stripe:
    //   1. alice → account exists with NULL → set
    //   2. bob   → account exists with same id → already-set
    //   3. carol → account exists with different id → mismatch-skip
    //   4. dave  → no account → no-account
    //   5. (no email) → no-email
    const stripeCustomers: StripeCustomer[] = [
      { id: "cus_ALICE", email: "alice@x.com" },
      { id: "cus_BOB", email: "bob@x.com" },
      { id: "cus_CAROL_NEW", email: "carol@x.com" },
      { id: "cus_DAVE", email: "dave@x.com" },
      { id: "cus_NOEMAIL", email: null },
    ];

    const list: StripeListFn = async ({ starting_after }) => {
      if (starting_after) return { data: [], has_more: false };
      return { data: stripeCustomers, has_more: false };
    };

    // DB responses mapped by lower(email):
    const lookups: Record<string, Array<{ id: string; stripe_customer_id: string | null }>> = {
      "alice@x.com": [{ id: "acc-alice", stripe_customer_id: null }],
      "bob@x.com": [{ id: "acc-bob", stripe_customer_id: "cus_BOB" }],
      "carol@x.com": [{ id: "acc-carol", stripe_customer_id: "cus_CAROL_OLD" }],
      "dave@x.com": [],
    };

    // We can't easily inspect the SQL object in execute(), so we drive the
    // mock by call ordering: SELECT → optional UPDATE. We track which select
    // is next by looking up by the customer the harness is processing.
    // Simpler approach: respond based on a counter that mirrors the customer
    // order, returning the SELECT result and (for alice only) an empty
    // UPDATE result.
    let queryIdx = 0;
    const orderedResponses: Array<Array<Record<string, unknown>>> = [
      lookups["alice@x.com"]!, // SELECT
      [], // UPDATE for alice (apply=true)
      lookups["bob@x.com"]!, // SELECT
      lookups["carol@x.com"]!, // SELECT
      lookups["dave@x.com"]!, // SELECT
      // no DB call for null-email customer
    ];
    const db = {
      execute: vi.fn(async () => {
        const r = orderedResponses[queryIdx] ?? [];
        queryIdx += 1;
        return r;
      }),
    };

    const records: Array<unknown> = [];
    const result = await runBackfill(
      db as never,
      { apply: true },
      list,
      (r) => records.push(r),
    );

    expect(result.counts).toEqual({
      scanned: 5,
      matched: 3, // alice + bob + carol matched an account
      set: 1, // alice
      alreadySet: 1, // bob
      mismatchSkipped: 1, // carol
      noAccount: 1, // dave
      noEmail: 1, // null-email customer
    });

    // 4 SELECTs (alice, bob, carol, dave) + 1 UPDATE (alice) = 5 db calls.
    expect(db.execute).toHaveBeenCalledTimes(5);
  });

  it("dry-run mode: zero UPDATEs even when there are settable rows", async () => {
    const list: StripeListFn = async ({ starting_after }) => {
      if (starting_after) return { data: [], has_more: false };
      return {
        data: [{ id: "cus_X", email: "x@example.com" }],
        has_more: false,
      };
    };

    const db = {
      execute: vi.fn(async () => [{ id: "acc-x", stripe_customer_id: null }]),
    };

    const result = await runBackfill(db as never, { apply: false }, list, () => {});

    expect(result.counts.set).toBe(1);
    // Only the SELECT — no UPDATE in dry-run.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
