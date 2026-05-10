// ---------------------------------------------------------------------------
// Watchtower Stripe handler tests.
//
// Mocked DB pattern (mirrors customer-account-linker.test.ts) — no embedded
// Postgres needed. We assert:
//   1. checkout.session.completed inserts a row with the right shape
//   2. replayed checkout event = update path, no duplicate insert
//   3. linker is called with the right args
//   4. mapStripeStatus mapping is correct (active/past_due/paused/cancelled/no-op)
//   5. subscription.updated mirrors status verbatim
//   6. subscription.deleted forces status=cancelled
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleWatchtowerCheckout,
  handleWatchtowerSubscriptionUpdated,
  handleWatchtowerSubscriptionDeleted,
  mapStripeStatus,
} from "../services/watchtower-stripe-handler.js";

// We mock the linker so checkout-handler tests can assert it was called
// without pulling in the linker's own SQL upsert.
const linkSpy = vi.fn(async () => ({ action: "created", accountId: "acc-1" }));
vi.mock("../services/customer-account-linker.js", () => ({
  linkStripeCustomerToAccount: (...args: unknown[]) => linkSpy(...args),
}));

// ---------------------------------------------------------------------------
// Tiny query-builder stub. Drizzle chains are select().from().where().limit()
// for reads, insert().values().returning() for writes, and
// update().set().where().returning() for status updates. Each chain stub
// returns a thenable that resolves to the queued result for that call.
// ---------------------------------------------------------------------------

type QueueEntry = { kind: string; result: unknown };

function makeDb(queue: QueueEntry[]) {
  const calls: Array<{ kind: string; payload: unknown }> = [];

  function next(kind: string): unknown {
    const entry = queue.shift();
    if (!entry) throw new Error(`No queued result for ${kind}`);
    if (entry.kind !== kind) {
      throw new Error(
        `Expected next call kind='${entry.kind}' but got '${kind}'`,
      );
    }
    return entry.result;
  }

  // SELECT chain
  function selectChain() {
    let payload: Record<string, unknown> = {};
    const chain = {
      from(table: unknown) {
        payload.table = table;
        return chain;
      },
      where(predicate: unknown) {
        payload.where = predicate;
        return chain;
      },
      limit(n: number) {
        payload.limit = n;
        calls.push({ kind: "select", payload });
        return Promise.resolve(next("select"));
      },
    };
    return chain;
  }

  // INSERT chain
  function insertChain(table: unknown) {
    const payload: Record<string, unknown> = { table };
    return {
      values(values: unknown) {
        payload.values = values;
        return {
          returning(_cols: unknown) {
            calls.push({ kind: "insert", payload });
            return Promise.resolve(next("insert"));
          },
        };
      },
    };
  }

  // UPDATE chain
  function updateChain(table: unknown) {
    const payload: Record<string, unknown> = { table };
    return {
      set(values: unknown) {
        payload.set = values;
        return {
          where(predicate: unknown) {
            payload.where = predicate;
            return {
              returning(_cols: unknown) {
                calls.push({ kind: "update", payload });
                return Promise.resolve(next("update"));
              },
            };
          },
        };
      },
    };
  }

  return {
    db: {
      select: () => selectChain(),
      insert: insertChain,
      update: updateChain,
    } as unknown as Parameters<typeof handleWatchtowerCheckout>[0],
    calls,
  };
}

beforeEach(() => {
  linkSpy.mockClear();
});

// ---------------------------------------------------------------------------
// mapStripeStatus
// ---------------------------------------------------------------------------

describe("mapStripeStatus", () => {
  it("maps active and trialing → active", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("active");
  });
  it("maps past_due and unpaid → past_due", () => {
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
  });
  it("maps paused → paused", () => {
    expect(mapStripeStatus("paused")).toBe("paused");
  });
  it("maps canceled and incomplete_expired → cancelled", () => {
    expect(mapStripeStatus("canceled")).toBe("cancelled");
    expect(mapStripeStatus("incomplete_expired")).toBe("cancelled");
  });
  it("returns null for incomplete and unknown statuses (no-op)", () => {
    expect(mapStripeStatus("incomplete")).toBeNull();
    expect(mapStripeStatus("garbage")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleWatchtowerCheckout
// ---------------------------------------------------------------------------

describe("handleWatchtowerCheckout", () => {
  const baseSession = {
    id: "cs_test_123",
    customer: "cus_ABC",
    customer_email: "buyer@example.com",
    subscription: "sub_ABC",
    metadata: {
      product: "watchtower",
      brandName: "ExampleCo",
      domain: "example.com",
      prompts: JSON.stringify(["prompt one", "prompt two"]),
      customerEmail: "buyer@example.com",
    },
  };

  it("inserts a new row when no existing subscription matches", async () => {
    const { db, calls } = makeDb([
      { kind: "select", result: [] }, // existing lookup → none
      { kind: "insert", result: [{ id: "sub-row-1" }] }, // returning id
    ]);

    const result = await handleWatchtowerCheckout(db, baseSession);

    expect(result).toEqual({ subscriptionId: "sub-row-1", created: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.kind).toBe("select");
    expect(calls[1]!.kind).toBe("insert");

    const insertedValues = (calls[1]!.payload as { values: Record<string, unknown> })
      .values;
    expect(insertedValues).toMatchObject({
      brandName: "ExampleCo",
      domain: "example.com",
      prompts: ["prompt one", "prompt two"],
      status: "active",
      frequency: "weekly",
      plan: "watchtower_monthly",
      stripeCustomerId: "cus_ABC",
      stripeSubscriptionId: "sub_ABC",
      email: "buyer@example.com",
      // account_id MUST be set from the linker so watchtower-cron's
      // resolveWatchtowerRecipient() can find the digest recipient.
      // Leaving it NULL = paid customer, no email, silent churn.
      accountId: "acc-1",
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(expect.anything(), {
      email: "buyer@example.com",
      stripeCustomerId: "cus_ABC",
    });
  });

  it("idempotency: replayed event UPDATES (no duplicate INSERT)", async () => {
    const { db, calls } = makeDb([
      { kind: "select", result: [{ id: "sub-existing-1" }] }, // existing row
      { kind: "update", result: [{ id: "sub-existing-1" }] }, // update path
    ]);

    const result = await handleWatchtowerCheckout(db, baseSession);
    expect(result).toEqual({ subscriptionId: "sub-existing-1", created: false });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.kind).toBe("select");
    expect(calls[1]!.kind).toBe("update");
    // No insert call — that's the idempotency guarantee.
    expect(calls.find((c) => c.kind === "insert")).toBeUndefined();
  });

  it("returns null and logs when metadata.product is not 'watchtower'", async () => {
    const { db, calls } = makeDb([]);
    const result = await handleWatchtowerCheckout(db, {
      ...baseSession,
      metadata: { ...baseSession.metadata, product: "creditscore" },
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
    expect(linkSpy).not.toHaveBeenCalled();
  });

  it("returns null when brandName missing", async () => {
    const { db, calls } = makeDb([]);
    const result = await handleWatchtowerCheckout(db, {
      ...baseSession,
      metadata: { ...baseSession.metadata, brandName: "" },
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null when subscription id missing", async () => {
    const { db, calls } = makeDb([]);
    const result = await handleWatchtowerCheckout(db, {
      ...baseSession,
      subscription: null,
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("tolerates malformed prompts metadata by inserting an empty array", async () => {
    const { db, calls } = makeDb([
      { kind: "select", result: [] },
      { kind: "insert", result: [{ id: "sub-row-2" }] },
    ]);
    const result = await handleWatchtowerCheckout(db, {
      ...baseSession,
      metadata: { ...baseSession.metadata, prompts: "{not json" },
    });
    expect(result?.created).toBe(true);
    const insertedValues = (calls[1]!.payload as { values: Record<string, unknown> })
      .values;
    expect(insertedValues.prompts).toEqual([]);
  });

  it("does not call linker when email or stripe customer id is missing", async () => {
    const { db } = makeDb([
      { kind: "select", result: [] },
      { kind: "insert", result: [{ id: "sub-row-3" }] },
    ]);

    await handleWatchtowerCheckout(db, {
      ...baseSession,
      customer: null,
      customer_email: null,
      customer_details: null,
      metadata: { ...baseSession.metadata, customerEmail: "" },
    });

    expect(linkSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleWatchtowerSubscriptionUpdated
// ---------------------------------------------------------------------------

describe("handleWatchtowerSubscriptionUpdated", () => {
  it("mirrors active → active and updates the matched row", async () => {
    const { db, calls } = makeDb([
      { kind: "update", result: [{ id: "sub-1" }] },
    ]);
    const result = await handleWatchtowerSubscriptionUpdated(db, {
      id: "sub_ABC",
      status: "active",
    });
    expect(result).toEqual({ matched: 1, status: "active" });
    expect((calls[0]!.payload as { set: Record<string, unknown> }).set).toEqual({
      status: "active",
    });
  });

  it("mirrors past_due and unpaid → past_due", async () => {
    const a = makeDb([{ kind: "update", result: [{ id: "sub-1" }] }]);
    const r1 = await handleWatchtowerSubscriptionUpdated(a.db, {
      id: "sub_X",
      status: "past_due",
    });
    expect(r1.status).toBe("past_due");

    const b = makeDb([{ kind: "update", result: [{ id: "sub-2" }] }]);
    const r2 = await handleWatchtowerSubscriptionUpdated(b.db, {
      id: "sub_Y",
      status: "unpaid",
    });
    expect(r2.status).toBe("past_due");
  });

  it("mirrors canceled → cancelled", async () => {
    const { db, calls } = makeDb([
      { kind: "update", result: [{ id: "sub-1" }] },
    ]);
    const result = await handleWatchtowerSubscriptionUpdated(db, {
      id: "sub_ABC",
      status: "canceled",
    });
    expect(result.status).toBe("cancelled");
    expect((calls[0]!.payload as { set: Record<string, unknown> }).set).toEqual({
      status: "cancelled",
    });
  });

  it("mirrors paused → paused", async () => {
    const { db } = makeDb([{ kind: "update", result: [{ id: "sub-1" }] }]);
    const r = await handleWatchtowerSubscriptionUpdated(db, {
      id: "sub_ABC",
      status: "paused",
    });
    expect(r.status).toBe("paused");
  });

  it("no-op (no DB call) when status is unmappable", async () => {
    const { db, calls } = makeDb([]);
    const r = await handleWatchtowerSubscriptionUpdated(db, {
      id: "sub_ABC",
      status: "incomplete",
    });
    expect(r).toEqual({ matched: 0, status: null });
    expect(calls).toHaveLength(0);
  });

  it("returns matched=0 (still resolves) when no row matches stripe sub id", async () => {
    const { db } = makeDb([{ kind: "update", result: [] }]);
    const r = await handleWatchtowerSubscriptionUpdated(db, {
      id: "sub_unknown",
      status: "active",
    });
    expect(r.matched).toBe(0);
    expect(r.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// handleWatchtowerSubscriptionDeleted
// ---------------------------------------------------------------------------

describe("handleWatchtowerSubscriptionDeleted", () => {
  it("forces status=cancelled regardless of incoming status", async () => {
    const { db, calls } = makeDb([
      { kind: "update", result: [{ id: "sub-1" }] },
    ]);
    const r = await handleWatchtowerSubscriptionDeleted(db, {
      id: "sub_ABC",
      status: "anything",
    });
    expect(r.matched).toBe(1);
    expect((calls[0]!.payload as { set: Record<string, unknown> }).set).toEqual({
      status: "cancelled",
    });
  });

  it("idempotency: replaying the delete is still a single UPDATE setting cancelled", async () => {
    const { db, calls: c1 } = makeDb([
      { kind: "update", result: [{ id: "sub-1" }] },
    ]);
    await handleWatchtowerSubscriptionDeleted(db, {
      id: "sub_ABC",
      status: "anything",
    });
    expect(c1).toHaveLength(1);

    const { db: db2, calls: c2 } = makeDb([
      { kind: "update", result: [{ id: "sub-1" }] },
    ]);
    await handleWatchtowerSubscriptionDeleted(db2, {
      id: "sub_ABC",
      status: "anything",
    });
    expect(c2).toHaveLength(1);
  });

  it("returns matched=0 when no row matches", async () => {
    const { db } = makeDb([{ kind: "update", result: [] }]);
    const r = await handleWatchtowerSubscriptionDeleted(db, {
      id: "sub_unknown",
      status: "anything",
    });
    expect(r.matched).toBe(0);
  });
});
