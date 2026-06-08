import type { Db } from "@paperclipai/db";
import { payouts } from "@paperclipai/db";
import { eq, inArray, sql } from "drizzle-orm";

/** Drizzle transaction handle, derived from the Db.transaction callback. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** State of a commission *before* it is reversed / clawed back. */
export interface AffectedCommission {
  status: string;
  amountCents: number;
  payoutBatchId: string | null;
}

/**
 * When commissions leave `scheduled_for_payout` (reversed or clawed back),
 * decrement the frozen `amountCents` / `commissionCount` of each parent payout
 * that is still `scheduled` (not yet sent), so the batch total never overstates
 * what is actually owed.
 *
 * Payouts already `sent` / `paid` are historical and left untouched — mutating
 * their totals would falsify the record of what was disbursed; those become
 * clawbacks against money already in flight, handled outside the payout row.
 *
 * Idempotent: callers pass the commission state captured BEFORE the status flip,
 * and only rows whose prior status was `scheduled_for_payout` count — so a
 * re-delivered webhook (whose rows are already `reversed`) decrements nothing.
 *
 * Must run inside the SAME transaction as the commission status update.
 */
export async function decrementUnsentPayouts(
  tx: DbTx,
  affected: AffectedCommission[],
): Promise<void> {
  const batched = affected.filter(
    (c) => c.status === "scheduled_for_payout" && c.payoutBatchId,
  );
  if (batched.length === 0) return;

  // Aggregate the reversed amount + count per parent payout batch.
  const perBatch = new Map<string, { cents: number; count: number }>();
  for (const c of batched) {
    const key = c.payoutBatchId as string;
    const cur = perBatch.get(key) ?? { cents: 0, count: 0 };
    cur.cents += c.amountCents;
    cur.count += 1;
    perBatch.set(key, cur);
  }

  const payoutRows = await tx
    .select({ id: payouts.id, status: payouts.status })
    .from(payouts)
    .where(inArray(payouts.id, [...perBatch.keys()]));

  for (const p of payoutRows) {
    if (p.status !== "scheduled") continue; // sent/paid: never falsify history
    const agg = perBatch.get(p.id);
    if (!agg) continue;
    await tx
      .update(payouts)
      .set({
        amountCents: sql`${payouts.amountCents} - ${agg.cents}`,
        commissionCount: sql`${payouts.commissionCount} - ${agg.count}`,
        updatedAt: sql`now()`,
      })
      .where(eq(payouts.id, p.id));
  }
}
