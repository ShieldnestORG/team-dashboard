// ---------------------------------------------------------------------------
// Coherent Ones University — refer-a-friend (credit-only) backend.
//
// Implements PHASE 1 of designs/DESIGN-referral-program.md (backend only — no
// portal/landing UI; those are Phase 2). Real money-handling code: every path
// is idempotent so a re-delivered Stripe webhook can never double-credit.
//
// The model (see the design doc for the full rationale):
//   - Every member gets a personal referral CODE (lazily created).
//   - When someone joins through it, attribution is locked first-touch on the
//     referred email (UNIQUE(referred_email)).
//   - The referrer earns $10/mo of membership CREDIT for every PAID month the
//     referred member keeps paying — accrued on `invoice.paid`, NEVER on
//     signup, and ONLY while the referrer is still an active member.
//   - Credit is applied to the referrer's OWN next invoice via the Stripe
//     customer credit balance, capped so their bill can never drop below a $5
//     floor (Stripe also refuses negative invoices as a backstop). The unused
//     credit rolls forward.
//   - Refund / dispute → a reversing ledger row. No cash ever left, so there is
//     no cash clawback.
//
// ONE shared, append-only, signed ledger (university_credit_ledger) is the
// source of truth: balance = SUM(amount_cents) WHERE email = ?. Repost-for-
// credit (Phase 2) will write into the SAME ledger so there is a single balance
// and a single floor check — making it arithmetically impossible to double-
// discount past the floor.
//
// Stripe: University bills on the SEPARATE Starwise account, so every outbound
// Stripe call uses universityStripeKey() — never the shared CD key.
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityMembers,
  universitySubscriptions,
  universityReferralCodes,
  universityReferrals,
  universityCreditLedger,
} from "@paperclipai/db";
import { stripeRequest, universityStripeKey } from "./stripe-client.js";
import { logger } from "../middleware/logger.js";

// --- Program constants (the spec's recommended defaults) --------------------

/** $10.00 of membership credit per referred member, per PAID month. */
export const REFERRAL_REWARD_CENTS = 1000;
/** A referrer's monthly bill can never be discounted below $5.00. */
export const CREDIT_FLOOR_CENTS = 500;
/**
 * FALLBACK dues — $50/mo (the founding monthly rate). Used only when the
 * member's real recurring amount is unknown (rows from before migration 0151
 * recorded unit_amount_cents — all founding-era). The apply headroom is
 * computed against the member's ACTUAL dues (memberDuesCents) so a $79
 * standard member or a $500 annual member isn't credited against the wrong
 * bill.
 */
const DUES_CENTS = 5000;
/** Stripe customer-balance currency. University dues are USD. */
const CREDIT_CURRENCY = "usd";

// Crockford base32 alphabet (no I, L, O, U — avoids look-alikes / accidental
// words). The code is random, NOT derived from the email, so it can't leak it.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LEN = 8;

// --- Narrow Stripe event shapes (the REST client is fetch-based; we avoid the
// full Stripe SDK types, mirroring university-stripe-handler.ts) -------------

export interface ReferralCheckoutSession {
  id: string;
  customer?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  subscription?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

export interface ReferralInvoice {
  id: string;
  subscription?: string | null;
  customer?: string | null;
  customer_email?: string | null;
}

export interface ReferralCharge {
  id: string;
  invoice?: string | null;
  customer?: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Generates a random 8-char Crockford base32 referral code. Collision-checking
 * is the caller's job (getOrCreateReferralCode retries on the UNIQUE(code)).
 */
export function generateReferralCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CROCKFORD[bytes[i]! % CROCKFORD.length];
  }
  return out;
}

/**
 * The floor guard — the single place a bug would spend real money. Returns how
 * many cents of credit to apply to THIS invoice:
 *   min(balance, bill - floor), clamped to ≥ 0.
 * So the bill can never drop below the floor and we never apply a negative.
 */
export function computeApplyAmountCents(args: {
  balanceCents: number;
  billCents: number;
  floorCents: number;
}): number {
  const headroom = args.billCents - args.floorCents; // most we can discount
  const applicable = Math.min(args.balanceCents, headroom);
  return applicable > 0 ? applicable : 0;
}

// ---------------------------------------------------------------------------
// Code generation / lookup
// ---------------------------------------------------------------------------

/**
 * Returns the member's referral code, creating it (idempotently) on first call.
 * Keyed on the lowercased email (the durable owner identity). Retries on a
 * UNIQUE(code) collision; the UNIQUE(email) makes re-calls return the same row.
 */
export async function getOrCreateReferralCode(
  db: Db,
  owner: { email: string; accountId?: string | null },
): Promise<{ code: string; created: boolean }> {
  const email = owner.email.trim().toLowerCase();
  const accountId = owner.accountId ?? null;

  const existing = await db
    .select({ code: universityReferralCodes.code })
    .from(universityReferralCodes)
    .where(sql`LOWER(${universityReferralCodes.email}) = ${email}`)
    .limit(1);
  if (existing[0]) return { code: existing[0].code, created: false };

  // Insert, retrying on a (rare) code collision. UNIQUE(email) means a racing
  // concurrent insert resolves to the existing row on the next select.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      const [row] = await db
        .insert(universityReferralCodes)
        .values({ email, accountId, code, status: "active" })
        .onConflictDoNothing()
        .returning({ code: universityReferralCodes.code });
      if (row) return { code: row.code, created: true };
      // Conflict (email or code already taken) → re-read.
      const reread = await db
        .select({ code: universityReferralCodes.code })
        .from(universityReferralCodes)
        .where(sql`LOWER(${universityReferralCodes.email}) = ${email}`)
        .limit(1);
      if (reread[0]) return { code: reread[0].code, created: false };
      // Else it was a code collision with a different email — retry a new code.
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, email, attempt },
        "university-referrals: code insert retrying",
      );
    }
  }
  throw new Error(
    `university-referrals: could not allocate a referral code for ${email}`,
  );
}

// ---------------------------------------------------------------------------
// Attribution — checkout.session.completed
// ---------------------------------------------------------------------------

function sessionEmail(session: ReferralCheckoutSession): string | null {
  const raw =
    session.metadata?.customerEmail
    || session.customer_details?.email
    || session.customer_email
    || null;
  return raw ? raw.trim().toLowerCase() : null;
}

function sessionRefCode(session: ReferralCheckoutSession): string | null {
  const raw =
    session.client_reference_id
    || session.metadata?.referral_code
    || null;
  return raw ? raw.trim() : null;
}

/**
 * Records (or blocks) a referral when a referred member completes checkout.
 *
 * - No ref code → no-op.
 * - Unknown / disabled code → no-op (we don't reject the checkout for it).
 * - Self-referral (referred email == referrer email) → records
 *   `self_referral_blocked` (audit, not deletion); no earning will ever fire.
 * - Referred email already a member → blocked (you can't "refer" an existing
 *   member); recorded `self_referral_blocked` for audit.
 * - Otherwise → first-touch-locked `pending` referral (UNIQUE(referred_email);
 *   the FIRST link wins via ON CONFLICT DO NOTHING).
 *
 * Idempotent: a replayed checkout hits ON CONFLICT DO NOTHING and changes
 * nothing.
 */
export async function handleReferralAttribution(
  db: Db,
  session: ReferralCheckoutSession,
): Promise<{ status: "recorded" | "self_blocked" | "existing_member" | "noop" }> {
  const code = sessionRefCode(session);
  if (!code) return { status: "noop" };

  const referredEmail = sessionEmail(session);
  if (!referredEmail) return { status: "noop" };

  // Resolve the code → referrer.
  const codeRow = await db
    .select({
      email: universityReferralCodes.email,
      accountId: universityReferralCodes.accountId,
      status: universityReferralCodes.status,
    })
    .from(universityReferralCodes)
    .where(eq(universityReferralCodes.code, code))
    .limit(1);
  if (!codeRow[0] || codeRow[0].status !== "active") {
    logger.info(
      { sessionId: session.id, code },
      "university-referrals: unknown/disabled referral code, ignoring",
    );
    return { status: "noop" };
  }
  const referrerEmail = codeRow[0].email.trim().toLowerCase();
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  // --- Fraud: self-referral ---
  if (referredEmail === referrerEmail) {
    await recordBlockedReferral(db, {
      code,
      referrerEmail,
      referrerAccountId: codeRow[0].accountId,
      referredEmail,
      stripeSubscriptionId,
    });
    logger.warn(
      { sessionId: session.id, referrerEmail },
      "university-referrals: self-referral blocked",
    );
    return { status: "self_blocked" };
  }

  // --- Fraud: can't refer an existing member ---
  const existingMember = await db
    .select({ id: universityMembers.id })
    .from(universityMembers)
    .where(sql`LOWER(${universityMembers.email}) = ${referredEmail}`)
    .limit(1);
  if (existingMember[0]) {
    await recordBlockedReferral(db, {
      code,
      referrerEmail,
      referrerAccountId: codeRow[0].accountId,
      referredEmail,
      stripeSubscriptionId,
    });
    logger.warn(
      { sessionId: session.id, referredEmail },
      "university-referrals: referred email is already a member, blocked",
    );
    return { status: "existing_member" };
  }

  // --- First-touch attribution lock ---
  await db
    .insert(universityReferrals)
    .values({
      referrerCode: code,
      referrerEmail,
      referrerAccountId: codeRow[0].accountId,
      referredEmail,
      stripeSubscriptionId,
      status: "pending",
    })
    .onConflictDoNothing(); // UNIQUE(referred_email) — first link wins

  logger.info(
    { sessionId: session.id, referrerEmail, referredEmail },
    "university-referrals: attribution recorded (first-touch)",
  );
  return { status: "recorded" };
}

async function recordBlockedReferral(
  db: Db,
  row: {
    code: string;
    referrerEmail: string;
    referrerAccountId: string | null;
    referredEmail: string;
    stripeSubscriptionId: string | null;
  },
): Promise<void> {
  await db
    .insert(universityReferrals)
    .values({
      referrerCode: row.code,
      referrerEmail: row.referrerEmail,
      referrerAccountId: row.referrerAccountId,
      referredEmail: row.referredEmail,
      stripeSubscriptionId: row.stripeSubscriptionId,
      status: "self_referral_blocked",
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Earn + apply — invoice.paid
// ---------------------------------------------------------------------------

async function memberIsActive(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ status: universityMembers.status })
    .from(universityMembers)
    .where(sql`LOWER(${universityMembers.email}) = ${email}`)
    .limit(1);
  const status = rows[0]?.status;
  return status === "active" || status === "past_due";
}

async function ledgerBalanceCents(db: Db, email: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${universityCreditLedger.amountCents}), 0)`,
    })
    .from(universityCreditLedger)
    .where(sql`LOWER(${universityCreditLedger.email}) = ${email}`);
  return Number(rows[0]?.total ?? 0);
}

/**
 * The lifetime engine. On a referred member's `invoice.paid`:
 *   1. EARN — if the invoice's subscription maps to an active/pending referral
 *      AND the referrer is still an active member, accrue +$10 to the referrer
 *      (idempotent on the ledger UNIQUE(source, source_ref_id, invoice, kind)),
 *      and flip the referral pending → active.
 *   2. APPLY — for the PAYER of this invoice (referrer or anyone with credit),
 *      apply available credit down to the $5 floor via the Stripe customer
 *      balance, writing a -applied `credit_applied` ledger row.
 *
 * Both steps are skipped silently if there's nothing to do. Fully idempotent:
 * a replayed invoice.paid neither double-earns nor double-applies.
 */
export async function handleReferralInvoicePaid(
  db: Db,
  invoice: ReferralInvoice,
): Promise<{ earned: boolean; appliedCents: number }> {
  const invoiceId = invoice.id;
  const stripeSubscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : null;
  const payerCustomer =
    typeof invoice.customer === "string" ? invoice.customer : null;
  const payerEmail = invoice.customer_email
    ? invoice.customer_email.trim().toLowerCase()
    : null;

  // --- Step 1: EARN for the referrer of this (referred) subscription ---
  let earned = false;
  if (stripeSubscriptionId) {
    earned = await earnForReferral(db, { stripeSubscriptionId, invoiceId });
  }

  // --- Step 2: APPLY the payer's own credit to this invoice ---
  let appliedCents = 0;
  if (payerEmail) {
    appliedCents = await applyCreditForPayer(db, {
      email: payerEmail,
      customer: payerCustomer,
      invoiceId,
    });
  }

  return { earned, appliedCents };
}

async function earnForReferral(
  db: Db,
  args: { stripeSubscriptionId: string; invoiceId: string },
): Promise<boolean> {
  const ref = await db
    .select({
      id: universityReferrals.id,
      referrerEmail: universityReferrals.referrerEmail,
      referrerAccountId: universityReferrals.referrerAccountId,
      status: universityReferrals.status,
    })
    .from(universityReferrals)
    .where(
      and(
        eq(
          universityReferrals.stripeSubscriptionId,
          args.stripeSubscriptionId,
        ),
        inArray(universityReferrals.status, ["pending", "active"]),
      ),
    )
    .limit(1);
  if (!ref[0]) return false;

  const referrerEmail = ref[0].referrerEmail.trim().toLowerCase();

  // The reward is a MEMBERSHIP benefit — pause earning while the referrer is
  // not an active member (no banking credit for a non-member).
  if (!(await memberIsActive(db, referrerEmail))) {
    logger.info(
      { referralId: ref[0].id, referrerEmail },
      "university-referrals: referrer inactive — earning paused for this invoice",
    );
    return false;
  }

  const now = new Date();
  // Flip pending → active on the first paid invoice.
  if (ref[0].status === "pending") {
    await db
      .update(universityReferrals)
      .set({ status: "active", activatedAt: now, updatedAt: now })
      .where(eq(universityReferrals.id, ref[0].id));
  }

  // Accrue. Idempotent on the ledger UNIQUE index:
  // (source='referral', source_ref_id=referral.id, stripe_invoice_id, kind).
  const inserted = await db
    .insert(universityCreditLedger)
    .values({
      email: referrerEmail,
      accountId: ref[0].referrerAccountId,
      amountCents: REFERRAL_REWARD_CENTS,
      kind: "referral_earned",
      source: "referral",
      sourceRefId: ref[0].id,
      stripeInvoiceId: args.invoiceId,
      reason: "referral monthly accrual",
    })
    .onConflictDoNothing()
    .returning({ id: universityCreditLedger.id });

  if (inserted[0]) {
    logger.info(
      { referralId: ref[0].id, referrerEmail, invoiceId: args.invoiceId },
      "university-referrals: +$10 referral credit accrued",
    );
    return true;
  }
  // Replay — already accrued for this invoice.
  return false;
}

/**
 * The member's real recurring dues in cents — what their live subscription
 * actually bills (founding $50 / standard $79 / annual $500), recorded by the
 * webhook since migration 0151. Falls back to DUES_CENTS ($50) for pre-0151
 * rows (all founding-era, so the fallback is exact for them). Drives the
 * credit-apply headroom so the next renewal lands >= the floor on every tier.
 */
async function memberDuesCents(db: Db, email: string): Promise<number> {
  const rows = await db
    .select({ amt: universitySubscriptions.unitAmountCents })
    .from(universitySubscriptions)
    .where(
      and(
        sql`LOWER(${universitySubscriptions.email}) = ${email.toLowerCase()}`,
        inArray(universitySubscriptions.status, ["active", "past_due"]),
      ),
    )
    .orderBy(desc(universitySubscriptions.updatedAt))
    .limit(1);
  const amt = rows[0]?.amt;
  return typeof amt === "number" && amt > 0 ? amt : DUES_CENTS;
}

async function applyCreditForPayer(
  db: Db,
  args: { email: string; customer: string | null; invoiceId: string },
): Promise<number> {
  // Idempotency guard: one apply per invoice. The ledger UNIQUE index can't
  // enforce this for credit_applied rows (source_ref_id is NULL and NULLs don't
  // collide), so we guard explicitly — mirrors handleUniversityCheckout's
  // select-existing-first idempotency style.
  const already = await db
    .select({ id: universityCreditLedger.id })
    .from(universityCreditLedger)
    .where(
      and(
        eq(universityCreditLedger.kind, "credit_applied"),
        eq(universityCreditLedger.stripeInvoiceId, args.invoiceId),
      ),
    )
    .limit(1);
  if (already[0]) return 0;

  const balanceCents = await ledgerBalanceCents(db, args.email);
  if (balanceCents <= 0) return 0;

  // Headroom is computed against the member's real recurring dues (founding
  // $50 / standard $79 / annual $500), not the (already-paid) invoice total,
  // so the NEXT renewal lands at >= the floor regardless of tier.
  const applyCents = computeApplyAmountCents({
    balanceCents,
    billCents: await memberDuesCents(db, args.email),
    floorCents: CREDIT_FLOOR_CENTS,
  });
  if (applyCents <= 0) return 0;

  // Push the credit onto the Stripe customer balance (negative = credit toward
  // the NEXT invoice). Stripe auto-applies it and refuses a negative invoice.
  // We only ever push <= bill - floor, so the floor is enforced by US, not
  // Stripe (Stripe doesn't know our floor — it would happily zero the bill).
  if (args.customer) {
    try {
      await stripeRequest(
        "POST",
        `/customers/${args.customer}/balance_transactions`,
        {
          amount: -applyCents, // negative = credit
          currency: CREDIT_CURRENCY,
          description: `Coherent Ones referral credit (invoice ${args.invoiceId})`,
        },
        universityStripeKey(),
      );
    } catch (err) {
      // If the Stripe push fails, DO NOT write the ledger row — keeping the
      // ledger and Stripe in lockstep. The reconcile cron (Phase 2) catches
      // any drift. Surface loud, let the webhook retry.
      logger.error(
        { err: (err as Error).message, customer: args.customer, invoiceId: args.invoiceId },
        "university-referrals: Stripe balance push failed — NOT writing ledger row",
      );
      throw err;
    }
  } else {
    logger.warn(
      { email: args.email, invoiceId: args.invoiceId },
      "university-referrals: no Stripe customer on invoice — recording applied credit without Stripe push",
    );
  }

  await db.insert(universityCreditLedger).values({
    email: args.email,
    amountCents: -applyCents,
    kind: "credit_applied",
    source: "referral",
    sourceRefId: null,
    stripeInvoiceId: args.invoiceId,
    reason: "credit applied to invoice via Stripe customer balance",
  });

  logger.info(
    { email: args.email, invoiceId: args.invoiceId, applyCents },
    "university-referrals: credit applied",
  );
  return applyCents;
}

// ---------------------------------------------------------------------------
// Reversal — charge.refunded / dispute
// ---------------------------------------------------------------------------

/**
 * Reverses referral credit when a referred member's charge is refunded or
 * disputed. Writes a -$10 `referral_reversed` row for the referrer for the
 * affected invoice (idempotent on the ledger UNIQUE index). Credit-only means
 * no cash ever left, so there is no cash clawback — the referrer's balance
 * simply drops (and may go negative, netting against future credit).
 */
export async function handleReferralRefund(
  db: Db,
  charge: ReferralCharge,
): Promise<{ reversed: boolean }> {
  const invoiceId = typeof charge.invoice === "string" ? charge.invoice : null;
  if (!invoiceId) {
    logger.info(
      { chargeId: charge.id },
      "university-referrals: refund has no invoice id — cannot map to a referral, ignoring",
    );
    return { reversed: false };
  }

  // Find the referral_earned row(s) for this invoice — that tells us the
  // referrer + amount to reverse. (One referral_earned per invoice.)
  const earnedRows = await db
    .select({
      email: universityCreditLedger.email,
      accountId: universityCreditLedger.accountId,
      amountCents: universityCreditLedger.amountCents,
      sourceRefId: universityCreditLedger.sourceRefId,
    })
    .from(universityCreditLedger)
    .where(
      and(
        eq(universityCreditLedger.kind, "referral_earned"),
        eq(universityCreditLedger.stripeInvoiceId, invoiceId),
      ),
    );
  if (earnedRows.length === 0) {
    logger.info(
      { chargeId: charge.id, invoiceId },
      "university-referrals: no referral_earned for this invoice — nothing to reverse",
    );
    return { reversed: false };
  }

  let reversed = false;
  for (const earned of earnedRows) {
    const inserted = await db
      .insert(universityCreditLedger)
      .values({
        email: earned.email,
        accountId: earned.accountId,
        amountCents: -earned.amountCents, // reverse the +$10
        kind: "referral_reversed",
        source: "referral",
        sourceRefId: earned.sourceRefId,
        stripeInvoiceId: invoiceId,
        reason: `reversal: charge ${charge.id} refunded/disputed`,
      })
      .onConflictDoNothing() // idempotent on (referral, refId, invoice, reversed)
      .returning({ id: universityCreditLedger.id });
    if (inserted[0]) reversed = true;
  }

  if (reversed) {
    logger.info(
      { chargeId: charge.id, invoiceId },
      "university-referrals: referral credit reversed (no cash clawback)",
    );
  }
  return { reversed };
}
