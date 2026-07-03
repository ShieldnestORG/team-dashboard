/**
 * Route tests for PUT /commissions/:id/reverse (affiliateAdminRoutes).
 *
 * Guards added during the 2026-06-07 affiliate audit follow-up:
 *   - pending_activation / approved / held  -> reverse, no payout touched
 *   - scheduled_for_payout + payout 'scheduled' -> reverse + decrement payout
 *   - scheduled_for_payout + payout 'sent'  -> 409 (funds in flight)
 *   - paid / reversed                       -> 409 (no recompute, no falsify)
 *
 * The db is hand-stubbed to mirror the drizzle chain the handler issues:
 *   1) db.select(...).from(commissions).where(...).limit(1)   -> [commission]
 *   2) db.transaction(cb) with tx that may:
 *        a) tx.select(...).from(payouts).where(...).limit(1)  -> [payout]
 *        b) tx.update(payouts).set(...).where(...)            -> (awaited)
 *        c) tx.update(commissions).set(...).where(...).returning(...) -> [row]
 */

import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { commissions, payouts } from "@paperclipai/db";
import { affiliateAdminRoutes } from "../routes/affiliates.ts";
import { useLocalServer } from "./helpers/supertest-server.js";

function selectChain(resolve: (table: unknown) => unknown[]) {
  let table: unknown;
  const chain: Record<string, unknown> = {
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(resolve(table)),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(resolve(table)).then(res, rej),
  };
  return chain;
}

function createDb(opts: {
  commissionRow: Record<string, unknown> | null;
  payoutRow?: Record<string, unknown> | null;
}) {
  const calls = { payoutUpdated: false, commissionUpdated: false };

  const selectResolver = (table: unknown) => {
    if (table === commissions) return opts.commissionRow ? [opts.commissionRow] : [];
    if (table === payouts) return opts.payoutRow ? [opts.payoutRow] : [];
    return [];
  };

  const makeUpdate = (table: unknown) => {
    const term: Record<string, unknown> = {
      set: () => term,
      where: () => ({
        returning: () => {
          calls.commissionUpdated = true;
          return Promise.resolve([
            { id: opts.commissionRow?.id, status: "reversed", clawbackReason: "x" },
          ]);
        },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (table === payouts) calls.payoutUpdated = true;
          return Promise.resolve([]).then(res, rej);
        },
      }),
    };
    return term;
  };

  const db = {
    select: () => selectChain(selectResolver),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => selectChain(selectResolver),
        update: (table: unknown) => makeUpdate(table),
      };
      return cb(tx);
    },
    _calls: calls,
  };
  return db as never;
}

function makeApp(db: never) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor?: unknown }).actor = { type: "board", userId: "board", source: "session" };
    next();
  });
  app.use(affiliateAdminRoutes(db));
  return app;
}

const local = useLocalServer();

describe("PUT /commissions/:id/reverse — source-status guard", () => {
  it("reverses an approved commission without touching any payout", async () => {
    const db = createDb({
      commissionRow: { id: "c1", status: "approved", amountCents: 1000, payoutBatchId: null },
    });
    const res = await request(local.via(makeApp(db))).put("/commissions/c1/reverse").send({ reason: "fraud" });

    expect(res.status).toBe(200);
    expect(res.body.commission.status).toBe("reversed");
    expect((db as unknown as { _calls: { payoutUpdated: boolean } })._calls.payoutUpdated).toBe(false);
  });

  it("reverses a scheduled_for_payout commission AND decrements its still-scheduled payout", async () => {
    const db = createDb({
      commissionRow: {
        id: "c2",
        status: "scheduled_for_payout",
        amountCents: 2500,
        payoutBatchId: "p2",
      },
      payoutRow: { id: "p2", status: "scheduled" },
    });
    const res = await request(local.via(makeApp(db))).put("/commissions/c2/reverse").send({ reason: "refund" });

    expect(res.status).toBe(200);
    const calls = (db as unknown as { _calls: { payoutUpdated: boolean; commissionUpdated: boolean } })._calls;
    expect(calls.payoutUpdated).toBe(true);
    expect(calls.commissionUpdated).toBe(true);
  });

  it("blocks reversing a scheduled_for_payout commission once the payout is sent", async () => {
    const db = createDb({
      commissionRow: {
        id: "c3",
        status: "scheduled_for_payout",
        amountCents: 2500,
        payoutBatchId: "p3",
      },
      payoutRow: { id: "p3", status: "sent" },
    });
    const res = await request(local.via(makeApp(db))).put("/commissions/c3/reverse").send({ reason: "refund" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVALID_STATUS_TRANSITION");
    const calls = (db as unknown as { _calls: { payoutUpdated: boolean; commissionUpdated: boolean } })._calls;
    expect(calls.payoutUpdated).toBe(false);
    expect(calls.commissionUpdated).toBe(false);
  });

  it("blocks reversing a paid commission", async () => {
    const db = createDb({
      commissionRow: { id: "c4", status: "paid", amountCents: 2500, payoutBatchId: "p4" },
    });
    const res = await request(local.via(makeApp(db))).put("/commissions/c4/reverse").send({ reason: "refund" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("blocks reversing an already-reversed commission", async () => {
    const db = createDb({
      commissionRow: { id: "c5", status: "reversed", amountCents: 2500, payoutBatchId: null },
    });
    const res = await request(local.via(makeApp(db))).put("/commissions/c5/reverse").send({ reason: "refund" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("requires a reason", async () => {
    const db = createDb({
      commissionRow: { id: "c6", status: "approved", amountCents: 1000, payoutBatchId: null },
    });
    const res = await request(local.via(makeApp(db))).put("/commissions/c6/reverse").send({});

    expect(res.status).toBe(400);
  });

  it("404s when the commission does not exist", async () => {
    const db = createDb({ commissionRow: null });
    const res = await request(local.via(makeApp(db))).put("/commissions/nope/reverse").send({ reason: "x" });

    expect(res.status).toBe(404);
  });
});
