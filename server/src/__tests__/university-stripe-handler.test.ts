// ---------------------------------------------------------------------------
// Coherent Ones University Stripe handler tests.
//
// Mocked DB pattern (mirrors watchtower-stripe-handler.test.ts) — no embedded
// Postgres needed. A University member is its OWN entity, so checkout touches
// TWO tables (university_subscriptions + university_members). We assert:
//   1. checkout.session.completed creates a subscription AND a member
//   2. replayed checkout (same stripe_subscription_id) = update path, no
//      duplicate subscription insert
//   3. linker is called with the right args
//   4. mapStripeStatus mapping is correct (active/past_due/cancelled/no-op)
//   5. subscription.updated mirrors status onto subscription + member
//   6. subscription.deleted forces status=cancelled on both
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleUniversityCheckout,
  handleUniversitySubscriptionUpdated,
  handleUniversitySubscriptionDeleted,
  mapStripeStatus,
} from "../services/university-stripe-handler.js";

// We mock the linker so checkout-handler tests can assert it was called
// without pulling in the linker's own SQL upsert.
const linkSpy = vi.fn(async () => ({ action: "created", accountId: "acc-1" }));
vi.mock("../services/customer-account-linker.js", () => ({
  linkStripeCustomerToAccount: (...args: unknown[]) => linkSpy(...args),
}));

// The handlers now fire lifecycle emails (welcome/receipt/past_due/canceled)
// via sendCreditscoreEmail. No-op it so the tests touch no network (mirrors
// the integration test). Spy so we can assert which kinds fired.
const emailSpy = vi.fn(async () => undefined);
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: (...args: unknown[]) => emailSpy(...args),
}));

// ---------------------------------------------------------------------------
// Tiny query-builder stub. Drizzle chains are select().from().where().limit()
// for reads, insert().values().returning() for writes, and
// update().set().where().returning() for status updates. The two member
// UPDATEs in the subscription handlers do NOT call .returning(), so the
// update chain resolves on .where() too. Each chain stub returns a thenable
// that resolves to the queued result for that call.
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
    const payload: Record<string, unknown> = {};
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

  // UPDATE chain. .where() returns a thenable so an update WITHOUT .returning()
  // (the member mirror updates) resolves; chaining .returning() resolves with
  // the queued result for the update WITH a returning clause.
  function updateChain(table: unknown) {
    const payload: Record<string, unknown> = { table };
    return {
      set(values: unknown) {
        payload.set = values;
        const whereStep = {
          where(predicate: unknown) {
            payload.where = predicate;
            const thenable = {
              returning(_cols: unknown) {
                calls.push({ kind: "update", payload });
                return Promise.resolve(next("update"));
              },
              then(resolve: (v: unknown) => unknown) {
                calls.push({ kind: "update", payload });
                return Promise.resolve(next("update")).then(resolve);
              },
            };
            return thenable;
          },
        };
        return whereStep;
      },
    };
  }

  return {
    db: {
      select: () => selectChain(),
      insert: insertChain,
      update: updateChain,
    } as unknown as Parameters<typeof handleUniversityCheckout>[0],
    calls,
  };
}

beforeEach(() => {
  linkSpy.mockClear();
  emailSpy.mockClear();
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
  it("maps canceled and incomplete_expired → cancelled", () => {
    expect(mapStripeStatus("canceled")).toBe("cancelled");
    expect(mapStripeStatus("incomplete_expired")).toBe("cancelled");
  });
  it("returns null for incomplete, paused, and unknown statuses (no-op)", () => {
    // University has no 'paused' member state — paused is a deliberate no-op.
    expect(mapStripeStatus("incomplete")).toBeNull();
    expect(mapStripeStatus("paused")).toBeNull();
    expect(mapStripeStatus("garbage")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleUniversityCheckout
// ---------------------------------------------------------------------------

describe("handleUniversityCheckout", () => {
  const baseSession = {
    id: "cs_test_123",
    customer: "cus_ABC",
    customer_email: "buyer@example.com",
    subscription: "sub_ABC",
    metadata: {
      product: "university",
      displayName: "Jane Doe",
      customerEmail: "buyer@example.com",
    },
  };

  it("creates a subscription AND a member when none exist", async () => {
    const { db, calls } = makeDb([
      { kind: "select", result: [] }, // existing subscription → none
      { kind: "insert", result: [{ id: "sub-row-1" }] }, // insert subscription
      { kind: "select", result: [] }, // existing member → none
      { kind: "insert", result: [{ id: "member-row-1" }] }, // insert member
      { kind: "update", result: [{ id: "sub-row-1" }] }, // backfill member_id
    ]);

    const result = await handleUniversityCheckout(db, baseSession);

    expect(result).toEqual({
      subscriptionId: "sub-row-1",
      memberId: "member-row-1",
      created: true,
    });

    // Subscription insert shape.
    const subInsert = (calls[1]!.payload as { values: Record<string, unknown> })
      .values;
    expect(subInsert).toMatchObject({
      status: "active",
      plan: "university_monthly",
      stripeCustomerId: "cus_ABC",
      stripeSubscriptionId: "sub_ABC",
      stripeCheckoutSessionId: "cs_test_123",
      email: "buyer@example.com",
      accountId: "acc-1",
    });

    // Member insert shape.
    const memberInsert = (
      calls[3]!.payload as { values: Record<string, unknown> }
    ).values;
    expect(memberInsert).toMatchObject({
      email: "buyer@example.com",
      displayName: "Jane Doe",
      status: "active",
      plan: "university_monthly",
      accountId: "acc-1",
    });
    expect((memberInsert as { joinedAt?: unknown }).joinedAt).toBeInstanceOf(Date);

    // member_id backfilled onto the subscription.
    const backfill = (calls[4]!.payload as { set: Record<string, unknown> }).set;
    expect(backfill).toMatchObject({ memberId: "member-row-1" });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(expect.anything(), {
      email: "buyer@example.com",
      stripeCustomerId: "cus_ABC",
    });

    // Activation emails: welcome + receipt, to the member email.
    expect(emailSpy).toHaveBeenCalledTimes(2);
    expect(emailSpy).toHaveBeenCalledWith({
      kind: "university_welcome",
      to: "buyer@example.com",
      data: {
        firstName: "Jane",
        loginUrl: "https://app.coherencedaddy.com/login",
        lessonUrl:
          "https://app.coherencedaddy.com/university/curriculum/presence/the-leak",
      },
    });
    expect(emailSpy).toHaveBeenCalledWith({
      kind: "university_receipt",
      to: "buyer@example.com",
      data: {
        amount: "$50.00",
        dateISO: expect.any(String),
        plan: "Monthly",
        manageBillingUrl: "https://app.coherencedaddy.com/billing",
      },
    });
  });

  it("idempotency: replayed event UPDATES the subscription (no duplicate INSERT)", async () => {
    const { db, calls } = makeDb([
      { kind: "select", result: [{ id: "sub-existing-1" }] }, // existing sub
      { kind: "update", result: [{ id: "sub-existing-1" }] }, // update sub
      { kind: "select", result: [{ id: "member-existing-1" }] }, // existing member
      { kind: "update", result: [{ id: "member-existing-1" }] }, // update member
      { kind: "update", result: [{ id: "sub-existing-1" }] }, // backfill member_id
    ]);

    const result = await handleUniversityCheckout(db, baseSession);
    expect(result).toEqual({
      subscriptionId: "sub-existing-1",
      memberId: "member-existing-1",
      created: false,
    });

    // No subscription/member INSERT on replay — that's the idempotency guarantee.
    expect(calls.find((c) => c.kind === "insert")).toBeUndefined();
    expect(calls.filter((c) => c.kind === "select")).toHaveLength(2);
    expect(calls.filter((c) => c.kind === "update")).toHaveLength(3);
  });

  it("returns null and does nothing when metadata.product is not 'university'", async () => {
    const { db, calls } = makeDb([]);
    const result = await handleUniversityCheckout(db, {
      ...baseSession,
      metadata: { ...baseSession.metadata, product: "watchtower" },
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
    expect(linkSpy).not.toHaveBeenCalled();
  });

  it("returns null when email missing", async () => {
    const { db, calls } = makeDb([]);
    const result = await handleUniversityCheckout(db, {
      ...baseSession,
      customer_email: null,
      customer_details: null,
      metadata: { ...baseSession.metadata, customerEmail: "" },
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("returns null when subscription id missing", async () => {
    const { db, calls } = makeDb([]);
    const result = await handleUniversityCheckout(db, {
      ...baseSession,
      subscription: null,
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleUniversitySubscriptionUpdated
// ---------------------------------------------------------------------------

describe("handleUniversitySubscriptionUpdated", () => {
  it("mirrors active → active onto subscription AND member", async () => {
    const { db, calls } = makeDb([
      // subscription update (returning rows w/ memberId)
      { kind: "update", result: [{ id: "sub-1", memberId: "mem-1", email: "x@y.com" }] },
      // member update (mirror)
      { kind: "update", result: [{ id: "mem-1" }] },
    ]);
    const result = await handleUniversitySubscriptionUpdated(db, {
      id: "sub_ABC",
      status: "active",
    });
    expect(result).toEqual({ matched: 1, status: "active" });
    expect((calls[0]!.payload as { set: Record<string, unknown> }).set).toMatchObject({
      status: "active",
    });
    expect((calls[1]!.payload as { set: Record<string, unknown> }).set).toMatchObject({
      status: "active",
    });
  });

  it("mirrors past_due and canceled correctly", async () => {
    const a = makeDb([
      { kind: "update", result: [{ id: "sub-1", memberId: "mem-1", email: null }] },
      { kind: "update", result: [{ id: "mem-1" }] },
    ]);
    const r1 = await handleUniversitySubscriptionUpdated(a.db, {
      id: "sub_X",
      status: "past_due",
    });
    expect(r1.status).toBe("past_due");

    const b = makeDb([
      { kind: "update", result: [{ id: "sub-2", memberId: "mem-2", email: null }] },
      { kind: "update", result: [{ id: "mem-2" }] },
    ]);
    const r2 = await handleUniversitySubscriptionUpdated(b.db, {
      id: "sub_Y",
      status: "canceled",
    });
    expect(r2.status).toBe("cancelled");
  });

  it("sends university_past_due (touch 1) to the member email on past_due, and NOT on active", async () => {
    // active → no lifecycle email from this handler.
    const ok = makeDb([
      { kind: "update", result: [{ id: "sub-1", memberId: "mem-1", email: "x@y.com" }] },
      { kind: "update", result: [{ id: "mem-1" }] },
    ]);
    await handleUniversitySubscriptionUpdated(ok.db, { id: "sub_A", status: "active" });
    expect(emailSpy).not.toHaveBeenCalled();

    // past_due → one card-bounce email, touch 1, to the sub's email.
    emailSpy.mockClear();
    const pd = makeDb([
      { kind: "update", result: [{ id: "sub-2", memberId: "mem-2", email: "pd@y.com" }] },
      { kind: "update", result: [{ id: "mem-2" }] },
    ]);
    await handleUniversitySubscriptionUpdated(pd.db, { id: "sub_B", status: "past_due" });
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledWith({
      kind: "university_past_due",
      to: "pd@y.com",
      data: {
        manageBillingUrl: "https://app.coherencedaddy.com/billing",
        touch: 1,
      },
    });
  });

  it("no-op (no DB call) when status is unmappable (incl. paused)", async () => {
    const { db, calls } = makeDb([]);
    const r = await handleUniversitySubscriptionUpdated(db, {
      id: "sub_ABC",
      status: "paused",
    });
    expect(r).toEqual({ matched: 0, status: null });
    expect(calls).toHaveLength(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("returns matched=0 when no subscription row matches", async () => {
    const { db } = makeDb([{ kind: "update", result: [] }]);
    const r = await handleUniversitySubscriptionUpdated(db, {
      id: "sub_unknown",
      status: "active",
    });
    expect(r.matched).toBe(0);
    expect(r.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// handleUniversitySubscriptionDeleted
// ---------------------------------------------------------------------------

describe("handleUniversitySubscriptionDeleted", () => {
  it("forces status=cancelled on subscription AND member", async () => {
    const { db, calls } = makeDb([
      { kind: "update", result: [{ id: "sub-1", memberId: "mem-1", email: "x@y.com" }] },
      { kind: "update", result: [{ id: "mem-1" }] },
    ]);
    const r = await handleUniversitySubscriptionDeleted(db, {
      id: "sub_ABC",
      status: "anything",
    });
    expect(r.matched).toBe(1);
    expect((calls[0]!.payload as { set: Record<string, unknown> }).set).toMatchObject({
      status: "cancelled",
    });
    expect((calls[1]!.payload as { set: Record<string, unknown> }).set).toMatchObject({
      status: "cancelled",
    });

    // "Door back" email fires to the sub's email; accessEndDateISO omitted.
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledWith({
      kind: "university_canceled",
      to: "x@y.com",
      data: { rejoinUrl: "https://coherencedaddy.com/university" },
    });
  });

  it("returns matched=0 when no row matches", async () => {
    const { db } = makeDb([{ kind: "update", result: [] }]);
    const r = await handleUniversitySubscriptionDeleted(db, {
      id: "sub_unknown",
      status: "anything",
    });
    expect(r.matched).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });
});
