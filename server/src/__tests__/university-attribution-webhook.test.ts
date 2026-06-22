// ---------------------------------------------------------------------------
// Coherent Ones University — ad-attribution webhook (M3) unit tests.
//
// Mocked DB + mocked CAPI/TikTok modules — no embedded Postgres, no network.
// We assert the four behaviours that matter for M3:
//   1. checkout.session.completed (livemode) → idempotency row inserted, the
//      attribution row is stamped, the campaign is stamped onto the sub, and
//      Meta CAPI Purchase + TikTok CompletePayment fire with the session id as
//      the dedup event_id and the right value/currency.
//   2. a REDELIVERED event (idempotency row already present → ON CONFLICT
//      returns no row) does NOT fire CAPI/TikTok again.
//   3. a TEST-MODE event (livemode !== true) records the event but does NOT
//      fire prod conversions.
//   4. invoice.paid / invoice.payment_failed / charge.refunded each append a
//      ledger row to university_attribution_events.
//
// The DB is a hand-rolled fake that supports exactly the drizzle chains the
// module uses: insert().values().onConflictDoNothing().returning(),
// update().set().where(), and select().from().where().limit(). The CAPI/TikTok
// modules are mocked so we assert the call args without touching the network.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const purchaseSpy = vi.fn(async () => ({ skipped: true, reason: "not_configured" }));
const completePaymentSpy = vi.fn(async () => ({ skipped: true, reason: "not_configured" }));
vi.mock("../services/meta-capi.js", () => ({
  sendPurchaseEvent: (...a: unknown[]) => purchaseSpy(...a),
}));
vi.mock("../services/tiktok-events.js", () => ({
  sendCompletePaymentEvent: (...a: unknown[]) => completePaymentSpy(...a),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// eslint-disable-next-line import/first
import {
  handleAttributionCheckoutCompleted,
  handleAttributionInvoicePaid,
  handleAttributionInvoicePaymentFailed,
  handleAttributionChargeRefunded,
} from "../services/university-attribution-webhook.js";
// eslint-disable-next-line import/first
import {
  universityAttribution,
  universityAttributionEvents,
  universitySubscriptions,
  type Db,
} from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Fake DB. Records inserts/updates/selects. The idempotency insert's returning
// result is controlled per-test via `eventInsertReturns` (a row = first time;
// empty = redelivery). Subscription-id lookups return `subLookupReturns`.
// ---------------------------------------------------------------------------

interface Recorded {
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  updates: Array<{ table: string; set: Record<string, unknown> }>;
}

function makeDb(opts: {
  eventInsertReturns?: Array<{ id: string }>;
  subLookupReturns?: Array<{ id: string }>;
}): { db: Db; rec: Recorded } {
  const rec: Recorded = { inserts: [], updates: [] };
  const eventInsertReturns = opts.eventInsertReturns ?? [{ id: "evt-row-1" }];
  const subLookupReturns = opts.subLookupReturns ?? [];

  const tableName = (t: unknown): string => {
    // Identify by reference identity against the real drizzle table objects —
    // robust where JSON.stringify (table name lives on a symbol) is not.
    if (t === universityAttributionEvents) return "events";
    if (t === universityAttribution) return "attribution";
    if (t === universitySubscriptions) return "subscriptions";
    return "unknown";
  };

  const db = {
    insert(table: unknown) {
      const label = tableName(table);
      return {
        values(values: Record<string, unknown>) {
          rec.inserts.push({ table: label, values });
          return {
            onConflictDoNothing() {
              return {
                returning() {
                  return Promise.resolve(eventInsertReturns);
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      const label = tableName(table);
      return {
        set(set: Record<string, unknown>) {
          rec.updates.push({ table: label, set });
          return {
            where() {
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(subLookupReturns);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Db;

  return { db, rec };
}

const META = { value: 50, currency: "USD" };

function checkoutEvent(over: Partial<{ livemode: boolean; metadata: Record<string, string> }> = {}) {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    livemode: over.livemode ?? true,
    data: {
      object: {
        id: "cs_test_session_1",
        object: "checkout_session",
        customer: "cus_1",
        subscription: "sub_1",
        customer_details: { email: "Lead@Example.com" },
        amount_total: 5000, // cents
        currency: "usd",
        metadata: over.metadata ?? {
          product: "university",
          customerEmail: "Lead@Example.com",
          at_fbc: "fb.1.abc",
          at_fbp: "fb.1.def",
          at_ttclid: "ttclid-xyz",
          at_utm_campaign: "summer",
          at_utm_source: "facebook",
        },
      },
    },
  };
}

describe("university-attribution-webhook (M3) — checkout.session.completed", () => {
  beforeEach(() => {
    purchaseSpy.mockClear();
    completePaymentSpy.mockClear();
  });

  it("stamps attribution + campaign and fires CAPI/TikTok with the session id as event_id", async () => {
    const { db, rec } = makeDb({ subLookupReturns: [{ id: "sub-row-uuid" }] });
    await handleAttributionCheckoutCompleted(db, checkoutEvent());

    // Idempotency row inserted into the events table.
    expect(rec.inserts.some((i) => i.table === "events")).toBe(true);

    // Attribution row stamped + subscription campaign stamped.
    expect(rec.updates.some((u) => u.table === "attribution")).toBe(true);
    expect(rec.updates.some((u) => u.table === "subscriptions")).toBe(true);

    // Meta CAPI Purchase fired with the right shape.
    expect(purchaseSpy).toHaveBeenCalledTimes(1);
    const metaArg = purchaseSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(metaArg.eventId).toBe("cs_test_session_1"); // event_id = session id
    expect(metaArg.email).toBe("lead@example.com");
    expect(metaArg.value).toBe(META.value);
    expect(metaArg.currency).toBe(META.currency);
    expect(metaArg.fbc).toBe("fb.1.abc");
    expect(metaArg.fbp).toBe("fb.1.def");

    // TikTok CompletePayment fired with the same dedup event_id + ttclid.
    expect(completePaymentSpy).toHaveBeenCalledTimes(1);
    const ttArg = completePaymentSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(ttArg.eventId).toBe("cs_test_session_1");
    expect(ttArg.ttclid).toBe("ttclid-xyz");
    expect(ttArg.value).toBe(META.value);
  });

  it("does NOT fire conversions on a redelivered event (idempotency guard)", async () => {
    // ON CONFLICT returns no row → already processed.
    const { db } = makeDb({ eventInsertReturns: [] });
    await handleAttributionCheckoutCompleted(db, checkoutEvent());

    expect(purchaseSpy).not.toHaveBeenCalled();
    expect(completePaymentSpy).not.toHaveBeenCalled();
  });

  it("records the event but does NOT fire prod conversions for a test-mode (livemode=false) event", async () => {
    const { db, rec } = makeDb({ subLookupReturns: [{ id: "sub-row-uuid" }] });
    await handleAttributionCheckoutCompleted(db, checkoutEvent({ livemode: false }));

    // Still recorded + still stamps the attribution data.
    expect(rec.inserts.some((i) => i.table === "events")).toBe(true);
    // But no conversion fired.
    expect(purchaseSpy).not.toHaveBeenCalled();
    expect(completePaymentSpy).not.toHaveBeenCalled();
  });

  it("ignores a non-university checkout", async () => {
    const { db, rec } = makeDb({});
    await handleAttributionCheckoutCompleted(
      db,
      checkoutEvent({ metadata: { product: "watchtower" } }),
    );
    expect(rec.inserts).toHaveLength(0);
    expect(purchaseSpy).not.toHaveBeenCalled();
  });
});

describe("university-attribution-webhook (M3) — ledger events", () => {
  function invoiceEvent(type: string) {
    return {
      id: `evt_${type}`,
      type,
      livemode: true,
      data: {
        object: {
          id: "in_1",
          customer: "cus_1",
          subscription: "sub_1",
          amount_paid: 5000,
          amount_due: 5000,
          currency: "usd",
          billing_reason: "subscription_cycle",
          customer_email: "lead@example.com",
        },
      },
    };
  }

  function chargeEvent() {
    return {
      id: "evt_charge_refunded",
      type: "charge.refunded",
      livemode: true,
      data: {
        object: {
          id: "ch_1",
          customer: "cus_1",
          invoice: "in_1",
          amount_refunded: 5000,
          currency: "usd",
          billing_details: { email: "lead@example.com" },
        },
      },
    };
  }

  it("invoice.paid appends a ledger row", async () => {
    const { db, rec } = makeDb({});
    await handleAttributionInvoicePaid(db, invoiceEvent("invoice.paid"));
    const ev = rec.inserts.find((i) => i.table === "events");
    expect(ev).toBeDefined();
    expect(ev!.values.eventType).toBe("invoice.paid");
    expect(ev!.values.stripeEventId).toBe("evt_invoice.paid");
  });

  it("invoice.payment_failed appends a ledger row", async () => {
    const { db, rec } = makeDb({});
    await handleAttributionInvoicePaymentFailed(
      db,
      invoiceEvent("invoice.payment_failed"),
    );
    const ev = rec.inserts.find((i) => i.table === "events");
    expect(ev).toBeDefined();
    expect(ev!.values.eventType).toBe("invoice.payment_failed");
  });

  it("charge.refunded appends a ledger row", async () => {
    const { db, rec } = makeDb({});
    await handleAttributionChargeRefunded(db, chargeEvent());
    const ev = rec.inserts.find((i) => i.table === "events");
    expect(ev).toBeDefined();
    expect(ev!.values.eventType).toBe("charge.refunded");
    expect(ev!.values.stripeCustomerId).toBe("cus_1");
  });
});
