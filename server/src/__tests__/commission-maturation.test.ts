/**
 * Unit tests for the affiliate:commission-maturation cron.
 *
 * Same pattern as affiliate-crons.test.ts — mock `registerCronJob` to capture
 * the handler, mock email templates, stub the db.update().set().where().returning()
 * chain, and re-implement the WHERE predicate in JS against a fixture set.
 *
 * Rules exercised (mirroring services/affiliate-crons.ts):
 *   status === 'pending_activation' AND holdExpiresAt < NOW()
 *     → mark approved
 *   status === 'pending_activation' AND holdExpiresAt >= NOW()
 *     → leave alone
 *   status === 'approved' (or anything else)
 *     → never touched
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAffiliateCrons } from "../services/affiliate-crons.ts";

type CommissionRow = {
  id: string;
  status: string;
  holdExpiresAt: Date | null;
  updatedAt: Date;
};

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

function createDbStub(rows: CommissionRow[], now: Date) {
  const state = { rows: rows.map((r) => ({ ...r })) };

  // Track which WHERE we got — the handler for maturation targets
  // commissions; we identify by checking that the set value includes
  // status='approved'.
  const update = vi.fn(() => {
    let pendingSet: Partial<CommissionRow> | null = null;
    const chain = {
      set(values: Partial<CommissionRow>) {
        pendingSet = values;
        return chain;
      },
      where(_cond: unknown) {
        return {
          async returning(_cols: unknown) {
            const set = pendingSet;
            const matured: Array<{ id: string }> = [];
            // Only apply to commissions rows — we assume any update that
            // sets status='approved' is the maturation handler.
            if (set?.status !== "approved") return [];
            for (const row of state.rows) {
              if (row.status !== "pending_activation") continue;
              if (!row.holdExpiresAt) continue;
              if (!(row.holdExpiresAt.getTime() < now.getTime())) continue;
              row.status = "approved";
              if (set.updatedAt !== undefined) row.updatedAt = set.updatedAt;
              matured.push({ id: row.id });
            }
            return matured;
          },
        };
      },
    };
    return chain;
  });

  // Other chain methods used elsewhere in startAffiliateCrons but not by
  // the maturation handler — make them inert so the cron module loads.
  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      async limit() {
        return [];
      },
      then(onFulfilled?: (v: unknown[]) => unknown) {
        return Promise.resolve([]).then(onFulfilled);
      },
    };
    return chain;
  });

  const insert = vi.fn(() => ({
    values: () => ({
      async onConflictDoNothing() {
        return [];
      },
      async returning() {
        return [];
      },
    }),
  }));

  const transaction = vi.fn(async () => {
    return undefined;
  });

  return {
    db: { update, select, insert, transaction } as unknown as import("@paperclipai/db").Db,
    state,
    update,
  };
}

describe("affiliate:commission-maturation cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
  });

  it("matures rows whose hold window has lapsed", async () => {
    const now = new Date("2026-04-20T03:15:00.000Z");
    vi.setSystemTime(now);

    const rows: CommissionRow[] = [
      {
        id: "c-matured",
        status: "pending_activation",
        holdExpiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    ];
    const { db, state } = createDbStub(rows, now);

    startAffiliateCrons(db);
    const handler = registeredJobs.get("affiliate:commission-maturation");
    expect(handler).toBeTruthy();

    const result = (await handler!()) as { released: number };
    expect(result.released).toBe(1);
    expect(state.rows[0].status).toBe("approved");

    vi.useRealTimers();
  });

  it("leaves pending rows whose hold window has NOT yet lapsed", async () => {
    const now = new Date("2026-04-20T03:15:00.000Z");
    vi.setSystemTime(now);

    const rows: CommissionRow[] = [
      {
        id: "c-still-pending",
        status: "pending_activation",
        holdExpiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    ];
    const { db, state } = createDbStub(rows, now);

    startAffiliateCrons(db);
    const handler = registeredJobs.get("affiliate:commission-maturation")!;
    const result = (await handler()) as { released: number };

    expect(result.released).toBe(0);
    expect(state.rows[0].status).toBe("pending_activation");

    vi.useRealTimers();
  });

  it("never touches already-approved rows", async () => {
    const now = new Date("2026-04-20T03:15:00.000Z");
    vi.setSystemTime(now);

    const rows: CommissionRow[] = [
      {
        id: "c-approved",
        status: "approved",
        // Even though hold has lapsed, status is no longer pending_activation.
        holdExpiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    ];
    const { db, state } = createDbStub(rows, now);

    startAffiliateCrons(db);
    const handler = registeredJobs.get("affiliate:commission-maturation")!;
    const result = (await handler()) as { released: number };

    expect(result.released).toBe(0);
    // Still approved — untouched.
    expect(state.rows[0].status).toBe("approved");

    vi.useRealTimers();
  });
});
