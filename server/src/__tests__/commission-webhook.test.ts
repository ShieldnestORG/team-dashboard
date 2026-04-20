/**
 * Unit tests for the Stripe webhook -> commissions ledger path in
 * server/src/routes/directory-listings.ts (handlePartnerStripeEvent).
 *
 * Strategy
 * --------
 * The event handler is a private function inside the route module, so we
 * cannot import it directly. Instead we mount `directoryListingsWebhookRoutes`
 * on a minimal Express app with supertest, and stub every boundary:
 *
 *   - `../services/stripe-client.js` — verifyStripeSignature always passes,
 *     stripeRequest resolves a stub subscription.
 *   - `../services/email-templates.js` — sendTransactional is a no-op.
 *   - The `db` passed to the router is a manually constructed stub that
 *     records every `select / insert / update` call and returns canned rows.
 *
 * We assert on the captured calls — not on SQL output — which is the same
 * compromise used in `affiliate-crons.test.ts`.
 *
 * Event payloads include `metadata.source = 'partner_network'` so the router
 * dispatches to handlePartnerStripeEvent.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/stripe-client.js", () => ({
  verifyStripeSignature: vi.fn(() => true),
  stripeRequest: vi.fn(async () => ({
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  })),
}));

vi.mock("../services/email-templates.js", () => ({
  sendTransactional: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER the mocks so the route module picks up mocked stripe-client.
// eslint-disable-next-line import/first
import { directoryListingsWebhookRoutes } from "../routes/directory-listings.ts";

// ---------------------------------------------------------------------------
// Db stub. Captures every insert / update / select call so tests can assert
// on `values` / `where` shapes and on `onConflictDoNothing` chain presence.
// ---------------------------------------------------------------------------
type CallLog = {
  selects: Array<{ fromTable: unknown }>;
  inserts: Array<{ table: unknown; values: unknown; hadOnConflict: boolean }>;
  updates: Array<{ table: unknown; set: unknown; wherePassed: boolean }>;
};

type SelectRowProvider = (calls: CallLog) => unknown[];

function createDbStub(opts: {
  selectRows: SelectRowProvider;
  /** What `insert(...).values(...).onConflictDoNothing()` resolves to. */
  insertResult?: unknown;
}) {
  const calls: CallLog = { selects: [], inserts: [], updates: [] };

  const buildSelectChain = (table: unknown) => {
    const chain = {
      from(_t: unknown) {
        return chain;
      },
      innerJoin(_t: unknown, _cond: unknown) {
        return chain;
      },
      where(_cond: unknown) {
        return chain;
      },
      orderBy(_cond: unknown) {
        return chain;
      },
      groupBy(..._cols: unknown[]) {
        return chain;
      },
      async limit(_n: number) {
        return opts.selectRows(calls);
      },
      then(
        onFulfilled?: (v: unknown[]) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        try {
          const rows = opts.selectRows(calls);
          return Promise.resolve(rows).then(onFulfilled, onRejected);
        } catch (err) {
          return Promise.reject(err).then(onFulfilled, onRejected);
        }
      },
    };
    return chain;
  };

  const select = vi.fn((_cols?: unknown) => ({
    from(table: unknown) {
      calls.selects.push({ fromTable: table });
      return buildSelectChain(table);
    },
  }));

  const insert = vi.fn((table: unknown) => {
    let capturedValues: unknown = null;
    const chain = {
      values(v: unknown) {
        capturedValues = v;
        return {
          async onConflictDoNothing() {
            calls.inserts.push({
              table,
              values: capturedValues,
              hadOnConflict: true,
            });
            return opts.insertResult ?? [];
          },
          then(onFulfilled?: (v: unknown) => unknown) {
            calls.inserts.push({
              table,
              values: capturedValues,
              hadOnConflict: false,
            });
            return Promise.resolve(opts.insertResult ?? []).then(onFulfilled);
          },
          async returning(_cols: unknown) {
            calls.inserts.push({
              table,
              values: capturedValues,
              hadOnConflict: false,
            });
            return opts.insertResult ?? [];
          },
        };
      },
    };
    return chain;
  });

  const update = vi.fn((table: unknown) => {
    let capturedSet: unknown = null;
    let whereCalled = false;
    const chain = {
      set(v: unknown) {
        capturedSet = v;
        return chain;
      },
      where(_cond: unknown) {
        whereCalled = true;
        calls.updates.push({ table, set: capturedSet, wherePassed: whereCalled });
        return {
          async returning(_cols: unknown) {
            return [];
          },
          then(onFulfilled?: (v: unknown) => unknown) {
            return Promise.resolve([]).then(onFulfilled);
          },
        };
      },
    };
    return chain;
  });

  const dbStub = { select, insert, update } as unknown as import("@paperclipai/db").Db;
  return { db: dbStub, calls, select, insert, update };
}

function makeApp(
  db: import("@paperclipai/db").Db,
): { app: express.Express } {
  const app = express();
  // Capture rawBody before json parser — mirrors app.ts.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use("/stripe", directoryListingsWebhookRoutes(db));
  return { app };
}

function stripeSigHeaders() {
  return { "stripe-signature": "t=0,v1=stub" };
}

describe("handlePartnerStripeEvent — commission ledger", () => {
  const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    vi.clearAllMocks();
  });

  // ---- case 1 ---------------------------------------------------------------
  it("checkout.session.completed with active attribution inserts a pending_activation initial commission", async () => {
    // Sequence of selects the handler issues:
    //   1) partnerCompanies lookup for slug       -> partner row
    //   2) attribution join                       -> attribution row
    // Any further selects would return []; we don't expect more.
    const partnerRow = {
      id: "partner-1",
      slug: "acme",
      contactEmail: null,
      contactName: null,
      name: "Acme",
      dashboardToken: null,
    };
    const attributionRow = {
      attributionId: "attr-1",
      affiliateId: "aff-1",
      leadId: "partner-1",
      rate: "0.10",
    };

    let selectCallIndex = 0;
    const { db, calls } = createDbStub({
      selectRows: () => {
        const idx = selectCallIndex++;
        if (idx === 0) return [partnerRow]; // contactEmail lookup
        if (idx === 1) return [attributionRow]; // attribution lookup
        return [];
      },
      insertResult: [],
    });

    const { app } = makeApp(db);

    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          customer: "cus_1",
          subscription: "sub_1",
          invoice: "in_abc",
          amount_total: 10_000, // $100.00
          metadata: { source: "partner_network", partner_slug: "acme" },
        },
      },
    };

    const res = await request(app)
      .post("/stripe/webhook")
      .set(stripeSigHeaders())
      .send(event);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true });

    // One insert into commissions with correct shape.
    expect(calls.inserts).toHaveLength(1);
    const [ins] = calls.inserts;
    const v = ins.values as Record<string, unknown>;
    expect(v.affiliateId).toBe("aff-1");
    expect(v.leadId).toBe("partner-1");
    expect(v.attributionId).toBe("attr-1");
    expect(v.type).toBe("initial");
    expect(v.amountCents).toBe(1000); // round(10_000 * 0.10)
    expect(v.basisCents).toBe(10_000);
    expect(v.status).toBe("pending_activation");
    expect(v.stripeInvoiceId).toBe("in_abc");
    // holdExpiresAt ~ 30d ahead of now.
    const hold = v.holdExpiresAt as Date;
    const delta = hold.getTime() - Date.now();
    expect(delta).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(delta).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    // onConflictDoNothing must be in the chain.
    expect(ins.hadOnConflict).toBe(true);
  });

  // ---- case 2 ---------------------------------------------------------------
  it("checkout.session.completed replayed — insert still runs but is a no-op via onConflictDoNothing", async () => {
    const partnerRow = {
      id: "partner-1",
      slug: "acme",
      contactEmail: null,
      contactName: null,
      name: "Acme",
      dashboardToken: null,
    };
    const attributionRow = {
      attributionId: "attr-1",
      affiliateId: "aff-1",
      leadId: "partner-1",
      rate: "0.10",
    };

    let selectCallIndex = 0;
    const { db, calls } = createDbStub({
      selectRows: () => {
        const mod = selectCallIndex % 2;
        selectCallIndex++;
        return mod === 0 ? [partnerRow] : [attributionRow];
      },
      insertResult: [], // simulate conflict-no-op — returning shape is empty.
    });

    const { app } = makeApp(db);

    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          customer: "cus_1",
          subscription: "sub_1",
          invoice: "in_abc",
          amount_total: 10_000,
          metadata: { source: "partner_network", partner_slug: "acme" },
        },
      },
    };

    await request(app).post("/stripe/webhook").set(stripeSigHeaders()).send(event).expect(200);
    await request(app).post("/stripe/webhook").set(stripeSigHeaders()).send(event).expect(200);

    // Each replay still calls insert once (handler is stateless); onConflict
    // guarantees the DB doesn't duplicate. We assert both inserts used the
    // onConflict chain.
    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts.every((i) => i.hadOnConflict)).toBe(true);
    // Values match on both runs.
    expect((calls.inserts[0].values as Record<string, unknown>).stripeInvoiceId).toBe("in_abc");
    expect((calls.inserts[1].values as Record<string, unknown>).stripeInvoiceId).toBe("in_abc");
  });

  // ---- case 3 ---------------------------------------------------------------
  it("invoice.payment_succeeded with billing_reason='subscription_create' does NOT insert a commission", async () => {
    // First select is the partnerCompanies lookup (needed by the is_paying
    // update guard). Returning one row lets the handler continue to the
    // billing_reason check where it bails.
    let selectCallIndex = 0;
    const partnerRow = {
      id: "partner-1",
      currentPeriodEnd: null,
      convertedAt: null,
    };
    const { db, calls } = createDbStub({
      selectRows: () => {
        const idx = selectCallIndex++;
        if (idx === 0) return [partnerRow];
        return [];
      },
    });

    const { app } = makeApp(db);

    const event = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_init",
          subscription: "sub_1",
          amount_paid: 10_000,
          period_start: 1_700_000_000,
          period_end: 1_702_500_000,
          billing_reason: "subscription_create",
          metadata: { source: "partner_network" },
        },
      },
    };

    await request(app).post("/stripe/webhook").set(stripeSigHeaders()).send(event).expect(200);

    // Only one update (partnerCompanies.is_paying). NO insert into commissions.
    expect(calls.inserts).toHaveLength(0);
  });

  // ---- case 4 ---------------------------------------------------------------
  it("invoice.payment_succeeded for a renewal inserts a recurring commission", async () => {
    const partnerRow = {
      id: "partner-1",
      currentPeriodEnd: null,
      convertedAt: null,
    };
    const attributionRow = {
      leadId: "partner-1",
      attributionId: "attr-1",
      affiliateId: "aff-1",
      rate: "0.15",
    };
    let selectCallIndex = 0;
    const { db, calls } = createDbStub({
      selectRows: () => {
        const idx = selectCallIndex++;
        if (idx === 0) return [partnerRow];
        if (idx === 1) return [attributionRow];
        return [];
      },
    });

    const { app } = makeApp(db);

    const periodStartSec = 1_700_000_000;
    const periodEndSec = 1_702_592_000;
    const event = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_renewal",
          subscription: "sub_1",
          amount_paid: 20_000, // $200
          period_start: periodStartSec,
          period_end: periodEndSec,
          billing_reason: "subscription_cycle",
          metadata: { source: "partner_network" },
        },
      },
    };

    await request(app).post("/stripe/webhook").set(stripeSigHeaders()).send(event).expect(200);

    expect(calls.inserts).toHaveLength(1);
    const v = calls.inserts[0].values as Record<string, unknown>;
    expect(v.type).toBe("recurring");
    expect(v.basisCents).toBe(20_000);
    expect(v.amountCents).toBe(3_000); // round(20000 * 0.15)
    expect(v.stripeInvoiceId).toBe("in_renewal");
    expect((v.periodStart as Date).getTime()).toBe(periodStartSec * 1000);
    expect((v.periodEnd as Date).getTime()).toBe(periodEndSec * 1000);
    expect(calls.inserts[0].hadOnConflict).toBe(true);
  });

  // ---- case 5 ---------------------------------------------------------------
  it("charge.refunded updates commissions via CASE expression (reverses pending rows)", async () => {
    const { db, calls } = createDbStub({ selectRows: () => [] });
    const { app } = makeApp(db);

    const event = {
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_refund_1",
          invoice: "in_abc",
          metadata: { source: "partner_network" },
        },
      },
    };

    await request(app).post("/stripe/webhook").set(stripeSigHeaders()).send(event).expect(200);

    expect(calls.updates).toHaveLength(1);
    const upd = calls.updates[0];
    const setObj = upd.set as Record<string, unknown>;
    expect(setObj.clawbackReason).toBe("stripe_refund");
    // status is a drizzle `sql` object — check it exists and stringifies
    // through queryChunks with a CASE literal so we know the branching SQL
    // is present.
    const statusExpr = setObj.status as { queryChunks?: unknown[] };
    expect(statusExpr).toBeDefined();
    const chunks = (statusExpr.queryChunks ?? []) as Array<{ value?: string[] }>;
    const rendered = chunks
      .map((c) => (Array.isArray(c?.value) ? c.value.join("") : ""))
      .join("");
    expect(rendered).toMatch(/CASE WHEN/i);
    expect(rendered).toMatch(/'paid'/);
    expect(rendered).toMatch(/'clawed_back'/);
    expect(rendered).toMatch(/'reversed'/);
    expect(upd.wherePassed).toBe(true);
  });

  // ---- case 6 ---------------------------------------------------------------
  it("charge.refunded SQL CASE maps already-paid commissions to 'clawed_back'", async () => {
    // Same handler path as case 5. We re-assert that the CASE has the
    // `WHEN status = 'paid' THEN 'clawed_back'` branch (shape inspection — we
    // cannot run SQL without a live DB).
    const { db, calls } = createDbStub({ selectRows: () => [] });
    const { app } = makeApp(db);

    const event = {
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_refund_2",
          invoice: "in_paid_already",
          metadata: { source: "partner_network" },
        },
      },
    };

    await request(app).post("/stripe/webhook").set(stripeSigHeaders()).send(event).expect(200);

    expect(calls.updates).toHaveLength(1);
    const statusExpr = (calls.updates[0].set as Record<string, unknown>).status as {
      queryChunks?: unknown[];
    };
    const chunks = (statusExpr.queryChunks ?? []) as Array<{ value?: string[] }>;
    const rendered = chunks
      .map((c) => (Array.isArray(c?.value) ? c.value.join("") : ""))
      .join("");
    // The CASE branches for both paid→clawed_back and else→reversed must both
    // appear in the SQL template — that's how Postgres will resolve the right
    // branch per-row.
    expect(rendered).toMatch(/WHEN.*=.*'paid'.*THEN.*'clawed_back'/s);
    expect(rendered).toMatch(/ELSE\s+'reversed'/s);
  });

  if (ORIGINAL_SECRET === undefined) {
    // no-op — env restoration handled per-test via vi.clearAllMocks + setter.
  }
});
