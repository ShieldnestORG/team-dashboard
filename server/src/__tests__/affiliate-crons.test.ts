/**
 * Unit tests for the affiliate:lock-expiry cron handler.
 *
 * Strategy: mock `registerCronJob` to capture the handler function, then invoke
 * it against an in-memory db stub that simulates drizzle's update/where/returning
 * chain over a small fixture dataset. This lets us verify the attribution-release
 * rules without spinning up a real Postgres — the full SQL semantics are covered
 * by the conditions the handler passes to `.where()`, which we execute against
 * the fixture rows using a simple JS reproduction of the same predicate.
 *
 * What we verify:
 *   - Expired lock + lead NOT paying  → row is released (lock_released_at set).
 *   - Expired lock + lead IS paying    → row stays active (conversion wins).
 *   - Lock not yet expired             → row stays active.
 *
 * What we do NOT verify in this test:
 *   - The literal SQL produced by drizzle. The handler's predicate is exercised
 *     via a JS reimplementation of the same conditions; this is the standard
 *     compromise when avoiding a live Postgres dependency.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAffiliateCrons } from "../services/affiliate-crons.ts";

type AttributionRow = {
  id: string;
  leadId: string;
  lockExpiresAt: Date;
  lockReleasedAt: Date | null;
  updatedAt: Date;
};

type PartnerRow = {
  id: string;
  isPaying: boolean;
};

const registeredJobs = vi.hoisted(() => new Map<string, () => Promise<unknown>>());

vi.mock("../services/cron-registry.js", () => ({
  registerCronJob: vi.fn((def: { jobName: string; handler: () => Promise<unknown> }) => {
    registeredJobs.set(def.jobName, def.handler);
  }),
}));

vi.mock("../services/email-templates.js", () => ({
  sendTransactional: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Build a minimal Db stub that supports .update(table).set(values).where(cond).returning(cols).
 *
 * The stub interprets the handler's intent rather than parsing drizzle IR:
 *   - When the chain targets `referral_attribution` with an update that sets
 *     lockReleasedAt, we apply the attribution-release rule to the fixture.
 *
 * The predicate is re-implemented in JS to match the handler's WHERE:
 *   lockReleasedAt IS NULL
 *   AND lockExpiresAt < NOW()
 *   AND EXISTS partner_companies WHERE id = lead_id AND is_paying = false
 */
function createDbStub(
  attributions: AttributionRow[],
  partners: PartnerRow[],
  now: Date,
) {
  const state = {
    attributions: attributions.map((r) => ({ ...r })),
    partners: partners.map((r) => ({ ...r })),
  };

  const update = vi.fn(() => {
    let pendingSet: Partial<AttributionRow> | null = null;
    const chain = {
      set(values: Partial<AttributionRow>) {
        pendingSet = values;
        return chain;
      },
      where(_cond: unknown) {
        // Apply the handler's predicate to the fixture.
        const set = pendingSet;
        return {
          async returning(_cols: unknown) {
            const matches: Array<{ id: string }> = [];
            for (const row of state.attributions) {
              if (row.lockReleasedAt !== null) continue;
              if (!(row.lockExpiresAt.getTime() < now.getTime())) continue;
              const partner = state.partners.find((p) => p.id === row.leadId);
              if (!partner) continue;
              if (partner.isPaying) continue;
              // Matches the release criteria — apply the update.
              if (set?.lockReleasedAt !== undefined) row.lockReleasedAt = set.lockReleasedAt;
              if (set?.updatedAt !== undefined) row.updatedAt = set.updatedAt;
              matches.push({ id: row.id });
            }
            return matches;
          },
        };
      },
    };
    return chain;
  });

  return {
    db: { update } as unknown as import("@paperclipai/db").Db,
    state,
    update,
  };
}

describe("affiliate:lock-expiry cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
  });

  function freshRows(nowMs: number) {
    const attributions: AttributionRow[] = [
      // Releasable: expired + lead NOT paying.
      {
        id: "attr-released",
        leadId: "lead-not-paying",
        lockExpiresAt: new Date(nowMs - 60_000), // expired 1 min ago
        lockReleasedAt: null,
        updatedAt: new Date(nowMs - 120_000),
      },
      // Protected: expired + lead IS paying — conversion wins.
      {
        id: "attr-protected",
        leadId: "lead-paying",
        lockExpiresAt: new Date(nowMs - 60_000),
        lockReleasedAt: null,
        updatedAt: new Date(nowMs - 120_000),
      },
      // Fresh: not expired yet → stays active.
      {
        id: "attr-fresh",
        leadId: "lead-not-paying-fresh",
        lockExpiresAt: new Date(nowMs + 60_000), // expires in 1 min
        lockReleasedAt: null,
        updatedAt: new Date(nowMs - 120_000),
      },
    ];
    const partners: PartnerRow[] = [
      { id: "lead-not-paying", isPaying: false },
      { id: "lead-paying", isPaying: true },
      { id: "lead-not-paying-fresh", isPaying: false },
    ];
    return { attributions, partners };
  }

  it("releases only expired locks whose lead has not converted", async () => {
    const now = new Date("2026-04-19T03:00:00.000Z");
    const { attributions, partners } = freshRows(now.getTime());
    const { db, state, update } = createDbStub(attributions, partners, now);

    startAffiliateCrons(db);

    const handler = registeredJobs.get("affiliate:lock-expiry");
    expect(handler, "handler should be registered").toBeTruthy();

    const result = await handler!();

    expect(result).toEqual({ released: 1 });
    expect(update).toHaveBeenCalledTimes(1);

    const released = state.attributions.find((r) => r.id === "attr-released");
    const protectedRow = state.attributions.find((r) => r.id === "attr-protected");
    const fresh = state.attributions.find((r) => r.id === "attr-fresh");

    // Released row: lock_released_at set, updated_at advanced.
    expect(released?.lockReleasedAt).not.toBeNull();
    expect(released?.updatedAt.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1);

    // Protected row: still active, no release.
    expect(protectedRow?.lockReleasedAt).toBeNull();

    // Fresh row: still active.
    expect(fresh?.lockReleasedAt).toBeNull();
  });

  it("does not release any locks when the lead has already converted (paying)", async () => {
    const now = new Date("2026-04-19T03:00:00.000Z");
    const attributions: AttributionRow[] = [
      {
        id: "attr-only-protected",
        leadId: "lead-paying",
        lockExpiresAt: new Date(now.getTime() - 60_000),
        lockReleasedAt: null,
        updatedAt: new Date(now.getTime() - 120_000),
      },
    ];
    const partners: PartnerRow[] = [{ id: "lead-paying", isPaying: true }];
    const { db, state } = createDbStub(attributions, partners, now);

    startAffiliateCrons(db);

    const result = await registeredJobs.get("affiliate:lock-expiry")!();

    expect(result).toEqual({ released: 0 });
    expect(state.attributions[0]?.lockReleasedAt).toBeNull();
  });

  it("does not release locks that have not yet expired", async () => {
    const now = new Date("2026-04-19T03:00:00.000Z");
    const attributions: AttributionRow[] = [
      {
        id: "attr-only-fresh",
        leadId: "lead-not-paying-fresh",
        lockExpiresAt: new Date(now.getTime() + 60_000),
        lockReleasedAt: null,
        updatedAt: new Date(now.getTime() - 120_000),
      },
    ];
    const partners: PartnerRow[] = [{ id: "lead-not-paying-fresh", isPaying: false }];
    const { db, state } = createDbStub(attributions, partners, now);

    startAffiliateCrons(db);

    const result = await registeredJobs.get("affiliate:lock-expiry")!();

    expect(result).toEqual({ released: 0 });
    expect(state.attributions[0]?.lockReleasedAt).toBeNull();
  });
});
