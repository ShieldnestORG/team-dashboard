/**
 * Unit tests for applyClawbackRecovery (services/clawback.ts).
 *
 * This is the FIFO core that nets an affiliate's outstanding clawback balance
 * against a payout's gross at mark-sent time. It walks open/recovering ledger
 * rows oldest-first, withholding up to the available amount, and returns the
 * total cents recovered (= the amount withheld from the payout).
 *
 * The tx is hand-stubbed the same way as payout-adjust.test.ts: the select chain
 * resolves to the configured ledger rows; each update records its set payload and
 * the target id recovered from the eq(affiliate_clawbacks.id, <id>) condition.
 */

import { describe, expect, it } from "vitest";
import { applyClawbackRecovery, type DbTx } from "../services/clawback.ts";

interface OpenRow {
  id: string;
  originAmountCents: number;
  recoveredCents: number;
}

function createTx(rows: OpenRow[]) {
  const updates: Array<{ id: string; set: Record<string, unknown> }> = [];

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => Promise.resolve(rows),
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
          updates.push({ id: extractId(cond), set: captured });
          return Promise.resolve([]);
        },
      };
      return chain;
    },
  };

  return { tx: tx as unknown as DbTx, updates };
}

// eq(affiliate_clawbacks.id, x) renders as a drizzle SQL object; the bound param
// is the id we want.
function extractId(cond: unknown): string {
  const chunks = (cond as { queryChunks?: unknown[] }).queryChunks ?? [];
  for (const c of chunks) {
    const v = (c as { value?: unknown }).value;
    if (typeof v === "string") return v;
  }
  return "unknown";
}

describe("applyClawbackRecovery", () => {
  it("returns 0 and does nothing when availableCents <= 0", async () => {
    const { tx, updates } = createTx([{ id: "c1", originAmountCents: 600, recoveredCents: 0 }]);
    const applied = await applyClawbackRecovery(tx, "aff1", 0);
    expect(applied).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("returns 0 when there is no outstanding balance", async () => {
    const { tx, updates } = createTx([]);
    const applied = await applyClawbackRecovery(tx, "aff1", 5000);
    expect(applied).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("fully recovers a single obligation when funds cover it", async () => {
    const { tx, updates } = createTx([{ id: "c1", originAmountCents: 600, recoveredCents: 0 }]);
    const applied = await applyClawbackRecovery(tx, "aff1", 1000);
    expect(applied).toBe(600);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("c1");
    expect(updates[0].set.recoveredCents).toBe(600);
    expect(updates[0].set.status).toBe("recovered");
  });

  it("partially recovers when funds are short, marking it recovering", async () => {
    const { tx, updates } = createTx([{ id: "c1", originAmountCents: 600, recoveredCents: 0 }]);
    const applied = await applyClawbackRecovery(tx, "aff1", 400);
    expect(applied).toBe(400);
    expect(updates).toHaveLength(1);
    expect(updates[0].set.recoveredCents).toBe(400);
    expect(updates[0].set.status).toBe("recovering");
  });

  it("continues an already-partial obligation from its prior recovered amount", async () => {
    const { tx, updates } = createTx([{ id: "c1", originAmountCents: 600, recoveredCents: 250 }]);
    const applied = await applyClawbackRecovery(tx, "aff1", 1000);
    expect(applied).toBe(350); // only 350 was still owed
    expect(updates[0].set.recoveredCents).toBe(600);
    expect(updates[0].set.status).toBe("recovered");
  });

  it("applies FIFO across multiple obligations and stops when funds run out", async () => {
    const { tx, updates } = createTx([
      { id: "c1", originAmountCents: 600, recoveredCents: 0 },
      { id: "c2", originAmountCents: 800, recoveredCents: 0 },
    ]);
    const applied = await applyClawbackRecovery(tx, "aff1", 1000);
    expect(applied).toBe(1000);
    expect(updates).toHaveLength(2);
    // c1 fully recovered (600), c2 partially (remaining 400).
    expect(updates[0]).toMatchObject({ id: "c1", set: { recoveredCents: 600, status: "recovered" } });
    expect(updates[1]).toMatchObject({ id: "c2", set: { recoveredCents: 400, status: "recovering" } });
  });

  it("never recovers more than the available funds", async () => {
    const { tx, updates } = createTx([
      { id: "c1", originAmountCents: 600, recoveredCents: 0 },
      { id: "c2", originAmountCents: 800, recoveredCents: 0 },
    ]);
    const applied = await applyClawbackRecovery(tx, "aff1", 500);
    expect(applied).toBe(500);
    // Only the first obligation is touched; c2 is never reached.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: "c1", set: { recoveredCents: 500, status: "recovering" } });
  });

  it("skips a fully-recovered row with nothing owed", async () => {
    const { tx, updates } = createTx([
      { id: "c1", originAmountCents: 500, recoveredCents: 500 },
      { id: "c2", originAmountCents: 300, recoveredCents: 0 },
    ]);
    const applied = await applyClawbackRecovery(tx, "aff1", 1000);
    expect(applied).toBe(300);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: "c2", set: { recoveredCents: 300, status: "recovered" } });
  });
});
