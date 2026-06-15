import { desc, eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { shopCommissions, shopReferralEvents, shopSharers } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Shop commissions service — turns paid WooCommerce orders that carry a ?ref=
// attribution into ledger rows. Pure helpers (rate math + HMAC signing) are
// exported for unit tests; recordWooOrder/listForAdmin touch the DB.
// See docs/products/affiliate-unified-links.md (Phase 3).
// ---------------------------------------------------------------------------

// Default flat commission rate, overridable via env (0 < rate <= 1).
export const SHOP_AFFILIATE_COMMISSION_RATE = (() => {
  const raw = Number(process.env.SHOP_AFFILIATE_COMMISSION_RATE);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.1;
})();

// Woo order statuses we treat as a realized, commissionable sale.
const PAID_STATUSES = new Set(["paid", "completed", "processing"]);

export function computeCommissionCents(grossCents: number, rate: number): number {
  if (!Number.isFinite(grossCents) || grossCents <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(grossCents * rate);
}

// Canonical string the WooCommerce-side adapter signs. Field order is part of
// the contract — keep it in sync with the adapter. See the Phase 3 spec.
export function wooSignaturePayload(p: {
  orderRef: string;
  referralCode: string;
  grossAmountCents: number;
  currency: string;
  status: string;
}): string {
  return [p.orderRef, p.referralCode, p.grossAmountCents, p.currency, p.status].join("|");
}

export function signWooPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// Timing-safe HMAC-SHA256 (hex) comparison. Returns false on any malformed
// input rather than throwing, so a bad signature is a clean 401 not a 500.
export function verifyWooSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret || typeof signature !== "string" || signature.length === 0) return false;
  const expected = signWooPayload(payload, secret);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export type RecordWooOrderResult =
  | { status: "created"; commission: typeof shopCommissions.$inferSelect }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

export function shopCommissionsService(db: Db) {
  // Idempotent by orderRef. Resolves the sharer from the ref code, writes a
  // 'purchase' shop_referral_events row + a shop_commissions row in one tx so
  // a duplicate/race leaves no orphan event.
  async function recordWooOrder(input: {
    orderRef: string;
    referralCode: string;
    grossAmountCents: number;
    currency?: string;
    status: string;
    rate?: number;
  }): Promise<RecordWooOrderResult> {
    const orderRef = (input.orderRef ?? "").trim();
    const referralCode = (input.referralCode ?? "").trim();
    if (!orderRef || !referralCode) {
      return { status: "ignored", reason: "missing_order_or_ref" };
    }
    if (!PAID_STATUSES.has(input.status)) {
      return { status: "ignored", reason: `status_not_paid:${input.status}` };
    }
    if (!Number.isFinite(input.grossAmountCents) || input.grossAmountCents <= 0) {
      return { status: "ignored", reason: "non_positive_amount" };
    }

    const [sharer] = await db
      .select({ id: shopSharers.id })
      .from(shopSharers)
      .where(eq(shopSharers.referralCode, referralCode))
      .limit(1);
    if (!sharer) return { status: "ignored", reason: "unknown_ref" };

    // Fast path: already recorded this order.
    const [existing] = await db
      .select({ id: shopCommissions.id })
      .from(shopCommissions)
      .where(eq(shopCommissions.orderRef, orderRef))
      .limit(1);
    if (existing) return { status: "duplicate" };

    const rate = input.rate ?? SHOP_AFFILIATE_COMMISSION_RATE;
    const currency = (input.currency ?? "usd").toLowerCase();
    const commissionCents = computeCommissionCents(input.grossAmountCents, rate);

    try {
      const commission = await db.transaction(async (tx) => {
        const [event] = await tx
          .insert(shopReferralEvents)
          .values({
            sharerId: sharer.id,
            referralCode,
            eventType: "purchase",
            amountCents: input.grossAmountCents,
          })
          .returning({ id: shopReferralEvents.id });

        const [row] = await tx
          .insert(shopCommissions)
          .values({
            sharerId: sharer.id,
            referralCode,
            referralEventId: event?.id ?? null,
            orderRef,
            grossAmountCents: input.grossAmountCents,
            rate: rate.toFixed(4),
            commissionCents,
            currency,
          })
          .returning();
        return row!;
      });
      return { status: "created", commission };
    } catch (err) {
      // Unique-index race on order_ref → treat as duplicate (tx rolled back the
      // purchase event too).
      if ((err as { code?: string }).code === "23505") return { status: "duplicate" };
      throw err;
    }
  }

  async function listForAdmin(limit = 100) {
    return db
      .select({
        id: shopCommissions.id,
        referralCode: shopCommissions.referralCode,
        sharerEmail: shopSharers.email,
        orderRef: shopCommissions.orderRef,
        grossAmountCents: shopCommissions.grossAmountCents,
        rate: shopCommissions.rate,
        commissionCents: shopCommissions.commissionCents,
        currency: shopCommissions.currency,
        status: shopCommissions.status,
        createdAt: shopCommissions.createdAt,
      })
      .from(shopCommissions)
      .leftJoin(shopSharers, eq(shopSharers.id, shopCommissions.sharerId))
      .orderBy(desc(shopCommissions.createdAt))
      .limit(limit);
  }

  return { recordWooOrder, listForAdmin };
}
