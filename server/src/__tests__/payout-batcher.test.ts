/**
 * Unit tests for the affiliate:payout-batcher cron.
 *
 * Same pattern as affiliate-crons.test.ts + commission-maturation.test.ts.
 *
 * The cron issues:
 *   1) A candidate aggregation select (affiliateId, approvedCents, count,
 *      minimumPayoutCents, payoutMethod).
 *   2) For each candidate at or above threshold, opens a transaction:
 *        a) tx.select approved commission rows
 *        b) tx.insert payouts -> returning { id }
 *        c) tx.update commissions set payoutBatchId + status
 *
 * The stub records inserts + updates per-transaction and returns the
 * candidate list provided by each test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAffiliateCrons } from "../services/affiliate-crons.ts";

const registeredJobs = vi.hoisted(
  () => new Map<string, () => Promise<unknown>>(),
);

vi.mock("../services/cron-registry.js", () => ({
  registerCronJob: vi.fn((def: { jobName: string; handler: () => Promise<unknown> }) => {
    registeredJobs.set(def.jobName, def.handler);
  }),
}));

vi.mock("../services/email-templates.js", () => ({
  sendTransactional: vi.fn().mockResolvedValue(undefined),
}));

type Candidate = {
  affiliateId: string;
  approvedCents: number;
  commissionCount: number;
  minimumPayoutCents: number | null;
  payoutMethod: string | null;
};

type ApprovedRow = { id: string; amountCents: number };

interface TxRecord {
  affiliateId: string;
  selectedApprovedIds: string[];
  insertedPayout: Record<string, unknown> | null;
  updatedCommissionIds: string[] | null;
  payoutIdReturned: string | null;
}

function createDbStub(opts: {
  candidates: Candidate[];
  /** Approved rows keyed by affiliateId. */
  approvedByAffiliate: Record<string, ApprovedRow[]>;
  /** If set, affiliateIds in this set will have the payout insert `returning`
   *  resolve to [] to simulate ON CONFLICT / prior-batch hit. */
  payoutReturnsEmptyFor?: Set<string>;
}) {
  const txRecords: TxRecord[] = [];

  // Outer db.select returns the candidate aggregation once.
  const outerSelect = vi.fn(() => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      groupBy: () => chain,
      async limit() {
        return opts.candidates;
      },
      then(onFulfilled?: (v: unknown[]) => unknown) {
        return Promise.resolve(opts.candidates).then(onFulfilled);
      },
    };
    return chain;
  });

  const outerUpdate = vi.fn(() => ({
    set: () => ({
      where: () => ({
        async returning() {
          return [];
        },
      }),
    }),
  }));

  const outerInsert = vi.fn(() => ({
    values: () => ({
      async onConflictDoNothing() {
        return [];
      },
      async returning() {
        return [];
      },
    }),
  }));

  const transaction = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      // The transaction's per-affiliate context. The handler:
      //   1. selects approved commissions for *some* affiliate (we don't
      //      know which one yet — we'll track via sequence).
      //   2. inserts a payouts row.
      //   3. updates commissions.
      // We create a per-tx record and infer the affiliateId from the insert's
      // `values.affiliateId`. To return the right approved rows from select()
      // we key on the most-recent record's affiliateId once insert fires; but
      // select runs first. To solve this, we consume the candidates in order:
      // the handler processes them sequentially, so the Nth transaction
      // corresponds to candidates[filtered][N]. We filter here to only those
      // that should be batched.
      const eligible = opts.candidates.filter((c) => {
        const threshold = c.minimumPayoutCents ?? 5000;
        return c.approvedCents >= threshold;
      });
      const index = txRecords.length;
      const candidate = eligible[index];
      const record: TxRecord = {
        affiliateId: candidate?.affiliateId ?? "<unknown>",
        selectedApprovedIds: [],
        insertedPayout: null,
        updatedCommissionIds: null,
        payoutIdReturned: null,
      };
      txRecords.push(record);

      const tx = {
        select: vi.fn(() => {
          const chain = {
            from: () => chain,
            innerJoin: () => chain,
            where: () => chain,
            groupBy: () => chain,
            async limit() {
              const rows = opts.approvedByAffiliate[record.affiliateId] ?? [];
              record.selectedApprovedIds = rows.map((r) => r.id);
              return rows;
            },
            then(onFulfilled?: (v: unknown[]) => unknown) {
              const rows = opts.approvedByAffiliate[record.affiliateId] ?? [];
              record.selectedApprovedIds = rows.map((r) => r.id);
              return Promise.resolve(rows).then(onFulfilled);
            },
          };
          return chain;
        }),
        insert: vi.fn(() => ({
          values: (v: Record<string, unknown>) => ({
            async returning() {
              record.insertedPayout = v;
              if (opts.payoutReturnsEmptyFor?.has(record.affiliateId)) {
                return [];
              }
              const id = `payout-${record.affiliateId}`;
              record.payoutIdReturned = id;
              return [{ id }];
            },
          }),
        })),
        update: vi.fn(() => ({
          set: (_v: Record<string, unknown>) => ({
            where: (_cond: unknown) => ({
              async returning() {
                // Even though the production handler doesn't call .returning()
                // here, we still tag the record so tests can assert that an
                // update happened.
                record.updatedCommissionIds = record.selectedApprovedIds.slice();
                return [];
              },
              then(onFulfilled?: (v: unknown) => unknown) {
                record.updatedCommissionIds = record.selectedApprovedIds.slice();
                return Promise.resolve([]).then(onFulfilled);
              },
            }),
          }),
        })),
      };

      return fn(tx);
    },
  );

  return {
    db: {
      select: outerSelect,
      update: outerUpdate,
      insert: outerInsert,
      transaction,
    } as unknown as import("@paperclipai/db").Db,
    txRecords,
    transaction,
  };
}

describe("affiliate:payout-batcher cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
  });

  it("inserts a payout + updates commissions when approved sum >= minimumPayoutCents", async () => {
    const candidates: Candidate[] = [
      {
        affiliateId: "aff-1",
        approvedCents: 12_000,
        commissionCount: 3,
        minimumPayoutCents: 5_000,
        payoutMethod: "manual_ach",
      },
    ];
    const approvedByAffiliate = {
      "aff-1": [
        { id: "c-1", amountCents: 4_000 },
        { id: "c-2", amountCents: 4_000 },
        { id: "c-3", amountCents: 4_000 },
      ],
    };

    const { db, txRecords, transaction } = createDbStub({
      candidates,
      approvedByAffiliate,
    });
    startAffiliateCrons(db);
    const handler = registeredJobs.get("affiliate:payout-batcher")!;
    expect(handler).toBeTruthy();

    const result = (await handler()) as {
      batched: number;
      skipped: number;
      totalCents: number;
    };

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.batched).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.totalCents).toBe(12_000);

    expect(txRecords).toHaveLength(1);
    const [rec] = txRecords;
    expect(rec.affiliateId).toBe("aff-1");
    // Payout was inserted with the right shape.
    expect(rec.insertedPayout).toMatchObject({
      affiliateId: "aff-1",
      amountCents: 12_000,
      commissionCount: 3,
      method: "manual_ach",
      status: "scheduled",
    });
    // Commissions were updated to reference the new payout.
    expect(rec.updatedCommissionIds).toEqual(["c-1", "c-2", "c-3"]);
    expect(rec.payoutIdReturned).toBe("payout-aff-1");
  });

  it("skips affiliates whose approved sum is below their minimumPayoutCents", async () => {
    const candidates: Candidate[] = [
      {
        affiliateId: "aff-below",
        approvedCents: 2_500,
        commissionCount: 1,
        minimumPayoutCents: 5_000,
        payoutMethod: "manual_paypal",
      },
    ];
    const { db, txRecords, transaction } = createDbStub({
      candidates,
      approvedByAffiliate: {
        "aff-below": [{ id: "c-1", amountCents: 2_500 }],
      },
    });

    startAffiliateCrons(db);
    const handler = registeredJobs.get("affiliate:payout-batcher")!;
    const result = (await handler()) as {
      batched: number;
      skipped: number;
      totalCents: number;
    };

    expect(transaction).not.toHaveBeenCalled();
    expect(result.batched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.totalCents).toBe(0);
    expect(txRecords).toHaveLength(0);
  });

  it("handles the zero-approved-rows case — no payout insert", async () => {
    // No candidates at all (the aggregation only returns rows where
    // approved commissions exist). The handler should no-op cleanly.
    const { db, txRecords, transaction } = createDbStub({
      candidates: [],
      approvedByAffiliate: {},
    });

    startAffiliateCrons(db);
    const handler = registeredJobs.get("affiliate:payout-batcher")!;
    const result = (await handler()) as {
      batched: number;
      skipped: number;
      failed: number;
      totalCents: number;
    };

    expect(transaction).not.toHaveBeenCalled();
    expect(result.batched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(txRecords).toHaveLength(0);
  });
});
