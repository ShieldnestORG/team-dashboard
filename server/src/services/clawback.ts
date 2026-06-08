import type { Db } from "@paperclipai/db";
import { affiliateClawbacks } from "@paperclipai/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbTx } from "./payout-adjust.js";

// Net-against-future-earnings only: an obligation not fully recovered within this
// window is flagged for write-off by the affiliate:clawback-writeoff cron. We
// never invoice the affiliate. 180 days ≈ 6 monthly payout cycles to net against.
export const CLAWBACK_RECOVERY_WINDOW_DAYS = 180;

// Statuses that still owe money (count toward the outstanding balance).
const OUTSTANDING_STATUSES = ["open", "recovering"] as const;

export interface RecordClawbackInput {
  affiliateId: string;
  sourceCommissionId: string;
  /** The clawed-back commission's amount_cents — the amount owed back. */
  originAmountCents: number;
  /** 'stripe_refund' | 'compliance_violation' | 'admin_manual' */
  reason: string;
  /** Board actor for manual clawbacks; null for automated paths. */
  createdByUserId?: string | null;
  notes?: string | null;
}

/**
 * Record a recovery obligation for a commission that was clawed back after its
 * money was already disbursed. Idempotent: the unique index on
 * source_commission_id means a re-delivered refund webhook (or a double-enforced
 * violation) inserts nothing the second time.
 *
 * Returns the row that was inserted, or null if one already existed.
 * Must run inside the SAME transaction as the commission status flip.
 */
export async function recordClawback(
  tx: DbTx,
  input: RecordClawbackInput,
): Promise<{ id: string } | null> {
  const [row] = await tx
    .insert(affiliateClawbacks)
    .values({
      affiliateId: input.affiliateId,
      sourceCommissionId: input.sourceCommissionId,
      originAmountCents: input.originAmountCents,
      reason: input.reason,
      createdByUserId: input.createdByUserId ?? null,
      notes: input.notes ?? null,
      windowExpiresAt: sql`now() + interval '${sql.raw(String(CLAWBACK_RECOVERY_WINDOW_DAYS))} days'`,
    })
    .onConflictDoNothing({ target: affiliateClawbacks.sourceCommissionId })
    .returning({ id: affiliateClawbacks.id });

  return row ?? null;
}

/**
 * Outstanding clawback balance for an affiliate in cents:
 * SUM(origin_amount_cents - recovered_cents) over open/recovering rows.
 * Read-only; safe to call outside a transaction.
 */
export async function getOutstandingBalanceCents(
  db: Db,
  affiliateId: string,
): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${affiliateClawbacks.originAmountCents} - ${affiliateClawbacks.recoveredCents}), 0)::int`,
    })
    .from(affiliateClawbacks)
    .where(
      and(
        eq(affiliateClawbacks.affiliateId, affiliateId),
        inArray(affiliateClawbacks.status, [...OUTSTANDING_STATUSES]),
      ),
    );
  return Number(row?.balance ?? 0);
}

/**
 * Net `availableCents` (a payout's gross owed) against the affiliate's
 * outstanding clawbacks, oldest-first (FIFO). Updates each consumed ledger row's
 * recovered_cents / status and returns the total cents recovered (0 if no
 * outstanding balance). Never recovers more than `availableCents`.
 *
 * Called at mark-sent time inside the payout transaction. The amount actually
 * disbursed to the affiliate is `availableCents - returnValue`.
 */
export async function applyClawbackRecovery(
  tx: DbTx,
  affiliateId: string,
  availableCents: number,
): Promise<number> {
  if (availableCents <= 0) return 0;

  const open = await tx
    .select({
      id: affiliateClawbacks.id,
      originAmountCents: affiliateClawbacks.originAmountCents,
      recoveredCents: affiliateClawbacks.recoveredCents,
    })
    .from(affiliateClawbacks)
    .where(
      and(
        eq(affiliateClawbacks.affiliateId, affiliateId),
        inArray(affiliateClawbacks.status, [...OUTSTANDING_STATUSES]),
      ),
    )
    .orderBy(asc(affiliateClawbacks.createdAt));

  let remaining = availableCents;
  let totalApplied = 0;

  for (const c of open) {
    if (remaining <= 0) break;
    const owed = c.originAmountCents - c.recoveredCents;
    if (owed <= 0) continue;
    const take = Math.min(owed, remaining);
    const newRecovered = c.recoveredCents + take;
    const fullyRecovered = newRecovered >= c.originAmountCents;

    await tx
      .update(affiliateClawbacks)
      .set({
        recoveredCents: newRecovered,
        status: fullyRecovered ? "recovered" : "recovering",
        updatedAt: sql`now()`,
      })
      .where(eq(affiliateClawbacks.id, c.id));

    remaining -= take;
    totalApplied += take;
  }

  return totalApplied;
}
