/**
 * Unit tests for decrementUnsentPayouts (services/payout-adjust.ts).
 *
 * This is the shared payout-integrity helper used by all three commission
 * reversal paths (admin reverse route, charge.refunded webhook, compliance
 * clawback). It decrements a parent payout's frozen amountCents / commissionCount
 * ONLY while that payout is still 'scheduled' (unsent), never once 'sent'/'paid'.
 *
 * The tx is hand-stubbed: tx.select(...).from(payouts).where(...) resolves to the
 * configured payout rows; tx.update(payouts).set(...).where(...) records the set.
 */

import { describe, expect, it } from "vitest";
import { decrementUnsentPayouts, type DbTx } from "../services/payout-adjust.ts";

function createTx(payoutRows: Array<{ id: string; status: string }>) {
  const updates: Array<{ id: string; set: Record<string, unknown> }> = [];

  const selectChain = {
    from: () => selectChain,
    where: () => Promise.resolve(payoutRows),
  };

  const tx = {
    select: () => selectChain,
    update: () => {
      let captured: Record<string, unknown> = {};
      const chain = {
        set: (v: Record<string, unknown>) => {
          captured = v;
          return chain;
        },
        where: (cond: unknown) => {
          // Recover the target id from the eq(payouts.id, <id>) condition.
          const id = (cond as { queryChunks?: Array<{ value?: unknown[] }> })?.queryChunks
            ? extractId(cond)
            : "unknown";
          updates.push({ id, set: captured });
          return Promise.resolve([]);
        },
      };
      return chain;
    },
  };

  return { tx: tx as unknown as DbTx, updates };
}

// eq(payouts.id, x) renders as a drizzle SQL object; the bound param is the id.
function extractId(cond: unknown): string {
  const chunks = (cond as { queryChunks?: unknown[] }).queryChunks ?? [];
  for (const c of chunks) {
    const v = (c as { value?: unknown }).value;
    if (typeof v === "string") return v;
  }
  return "unknown";
}

describe("decrementUnsentPayouts", () => {
  it("no-ops when nothing was scheduled_for_payout", async () => {
    const { tx, updates } = createTx([]);
    await decrementUnsentPayouts(tx, [
      { status: "approved", amountCents: 1000, payoutBatchId: null },
      { status: "paid", amountCents: 2000, payoutBatchId: "p1" },
      { status: "reversed", amountCents: 500, payoutBatchId: "p1" },
    ]);
    expect(updates).toHaveLength(0);
  });

  it("decrements a still-scheduled payout by the summed amount and count", async () => {
    const { tx, updates } = createTx([{ id: "p1", status: "scheduled" }]);
    await decrementUnsentPayouts(tx, [
      { status: "scheduled_for_payout", amountCents: 1500, payoutBatchId: "p1" },
      { status: "scheduled_for_payout", amountCents: 2500, payoutBatchId: "p1" },
    ]);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("p1");
    // amountCents / commissionCount are sql expressions — assert they are set.
    expect(updates[0].set.amountCents).toBeDefined();
    expect(updates[0].set.commissionCount).toBeDefined();
  });

  it("does NOT touch a payout that is already sent", async () => {
    const { tx, updates } = createTx([{ id: "p1", status: "sent" }]);
    await decrementUnsentPayouts(tx, [
      { status: "scheduled_for_payout", amountCents: 1500, payoutBatchId: "p1" },
    ]);
    expect(updates).toHaveLength(0);
  });

  it("does NOT touch a payout that is already paid", async () => {
    const { tx, updates } = createTx([{ id: "p1", status: "paid" }]);
    await decrementUnsentPayouts(tx, [
      { status: "scheduled_for_payout", amountCents: 1500, payoutBatchId: "p1" },
    ]);
    expect(updates).toHaveLength(0);
  });

  it("decrements scheduled batches and skips sent ones in a mixed set", async () => {
    const { tx, updates } = createTx([
      { id: "p1", status: "scheduled" },
      { id: "p2", status: "sent" },
    ]);
    await decrementUnsentPayouts(tx, [
      { status: "scheduled_for_payout", amountCents: 1000, payoutBatchId: "p1" },
      { status: "scheduled_for_payout", amountCents: 9999, payoutBatchId: "p2" },
    ]);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("p1");
  });

  it("ignores scheduled_for_payout rows with a null payoutBatchId", async () => {
    const { tx, updates } = createTx([{ id: "p1", status: "scheduled" }]);
    await decrementUnsentPayouts(tx, [
      { status: "scheduled_for_payout", amountCents: 1000, payoutBatchId: null },
    ]);
    expect(updates).toHaveLength(0);
  });
});
