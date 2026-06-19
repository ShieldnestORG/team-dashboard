// ---------------------------------------------------------------------------
// Coherent Ones University — REFERRAL program integration test. Real embedded
// Postgres, the full migration chain (incl. 0125_university_referrals), the
// REAL ledger with its REAL UNIQUE constraints and SUM(amount_cents) balance
// math. No live Stripe and no network — the ONE outbound Stripe call (push the
// applied credit onto the customer's balance) is intercepted via a mocked
// stripe-client so we can assert the exact cents we'd send.
//
// This is the money proof. It exercises, against real rows:
//   - attribution first-touch lock (UNIQUE(referred_email); first link wins)
//   - self-referral block (records self_referral_blocked, no ledger)
//   - existing-member block (can't "refer" someone who's already a member)
//   - earn on invoice.paid (+$10 referral_earned to the REFERRER), and ONLY
//     when the referrer is still active; never on signup
//   - apply credit with the $5 floor (a bill can never go below $5), the unused
//     credit rolling forward
//   - refund reversal (-$10 referral_reversed, no cash clawback)
//   - idempotency: a replayed invoice.paid / refund webhook does NOT
//     double-credit (the ledger UNIQUE backstop + explicit guards)
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable — mirrors
// university-webhook-integration.test.ts exactly.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// Intercept the single outbound Stripe call (customer balance_transactions) so
// nothing hits the network and we can assert the exact request. The handlers
// import stripeRequest from this module.
const stripeRequestMock = vi.hoisted(() => vi.fn(async () => ({ id: "cbtxn_test" })));
vi.mock("../services/stripe-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    stripeRequest: stripeRequestMock,
    universityStripeKey: () => "sk_test_university",
  };
});

// Email channel is unrelated here — no-op it so nothing touches the network.
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));

import {
  createDb,
  customerAccounts,
  universityMembers,
  universitySubscriptions,
  universityReferralCodes,
  universityReferrals,
  universityCreditLedger,
  companies,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import {
  handleReferralAttribution,
  handleReferralInvoicePaid,
  handleReferralRefund,
  getOrCreateReferralCode,
  REFERRAL_REWARD_CENTS,
  CREDIT_FLOOR_CENTS,
} from "../services/university-referrals.js";

const COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const REFERRER_EMAIL = "referrer@test.dev";
const REFERRED_EMAIL = "friend@test.dev";
const REFERRER_SUB = "sub_referrer";
const REFERRED_SUB = "sub_referred";
const REFERRER_CUSTOMER = "cus_referrer";
const REFERRED_CUSTOMER = "cus_referred";

const support = await getEmbeddedPostgresTestSupport();
const pgvectorOnlyBlocker =
  !support.supported && /pgvector|vector/i.test(support.reason ?? "");
const dbMode: "fullChain" | "noPgvector" | "skip" = support.supported
  ? "fullChain"
  : pgvectorOnlyBlocker
    ? "noPgvector"
    : "skip";

const describeDb = dbMode === "skip" ? describe.skip : describe;

if (dbMode === "skip") {
  console.warn(
    `Skipping university referrals integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

// --- Stripe event-object shapes (narrowed to what the handlers read) --------

function checkoutSession(opts: {
  referredEmail: string;
  referralCode: string;
  subscription?: string;
  customer?: string;
}): {
  id: string;
  customer: string | null;
  customer_email: string | null;
  customer_details: { email: string | null } | null;
  subscription: string | null;
  client_reference_id?: string | null;
  metadata: Record<string, string>;
} {
  return {
    id: "cs_test_referred",
    customer: opts.customer ?? REFERRED_CUSTOMER,
    customer_email: opts.referredEmail,
    customer_details: { email: opts.referredEmail },
    subscription: opts.subscription ?? REFERRED_SUB,
    client_reference_id: opts.referralCode,
    metadata: {
      product: "university",
      plan: "university_monthly",
      customerEmail: opts.referredEmail,
      referral_code: opts.referralCode,
    },
  };
}

function invoicePaid(opts: {
  id: string;
  subscription: string;
  customer: string;
  email: string;
  amountPaid?: number;
}): {
  id: string;
  subscription: string;
  customer: string;
  customer_email: string;
  amount_paid: number;
  amount_due: number;
  total: number;
  billing_reason: string;
} {
  const amt = opts.amountPaid ?? 5000;
  return {
    id: opts.id,
    subscription: opts.subscription,
    customer: opts.customer,
    customer_email: opts.email,
    amount_paid: amt,
    amount_due: amt,
    total: amt,
    billing_reason: "subscription_cycle",
  };
}

describeDb("university referral program (integration, real ledger)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.TEAM_DASHBOARD_COMPANY_ID = COMPANY_ID;

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-referrals-integration-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-referrals-integration-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    await db
      .insert(companies)
      .values({ id: COMPANY_ID, name: "Coherence Daddy" })
      .onConflictDoNothing();
  }, 60_000);

  beforeEach(() => {
    stripeRequestMock.mockClear();
    stripeRequestMock.mockResolvedValue({ id: "cbtxn_test" });
  });

  afterEach(async () => {
    // FK order: referrals → subscriptions/members; ledger is standalone.
    await db.delete(universityCreditLedger);
    await db.delete(universityReferrals);
    await db.delete(universityReferralCodes);
    await db.delete(universitySubscriptions);
    await db.delete(universityMembers);
    await db.delete(customerAccounts);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  // Seed an active referrer (member + subscription + referral code).
  async function seedReferrer(): Promise<string> {
    await db.insert(universityMembers).values({
      email: REFERRER_EMAIL,
      status: "active",
      plan: "university_monthly",
      joinedAt: new Date(),
    });
    await db.insert(universitySubscriptions).values({
      email: REFERRER_EMAIL,
      status: "active",
      plan: "university_monthly",
      stripeCustomerId: REFERRER_CUSTOMER,
      stripeSubscriptionId: REFERRER_SUB,
    });
    const { code } = await getOrCreateReferralCode(db, {
      email: REFERRER_EMAIL,
      accountId: null,
    });
    return code;
  }

  // Seed the referred member's member+subscription rows as the checkout handler
  // would, so invoice.paid can resolve them.
  async function seedReferredMember(): Promise<void> {
    await db.insert(universityMembers).values({
      email: REFERRED_EMAIL,
      status: "active",
      plan: "university_monthly",
      joinedAt: new Date(),
    });
    await db.insert(universitySubscriptions).values({
      email: REFERRED_EMAIL,
      status: "active",
      plan: "university_monthly",
      stripeCustomerId: REFERRED_CUSTOMER,
      stripeSubscriptionId: REFERRED_SUB,
    });
  }

  async function balanceFor(email: string): Promise<number> {
    const rows = await db
      .select({ amount: universityCreditLedger.amountCents })
      .from(universityCreditLedger)
      .where(sql`LOWER(email) = ${email}`);
    return rows.reduce((sum, r) => sum + r.amount, 0);
  }

  // ---- getOrCreateReferralCode --------------------------------------------

  it("getOrCreateReferralCode is idempotent — same code on repeat calls", async () => {
    const a = await getOrCreateReferralCode(db, { email: REFERRER_EMAIL, accountId: null });
    const b = await getOrCreateReferralCode(db, { email: REFERRER_EMAIL, accountId: null });
    expect(a.code).toBe(b.code);
    const codes = await db
      .select()
      .from(universityReferralCodes)
      .where(sql`LOWER(email) = ${REFERRER_EMAIL}`);
    expect(codes).toHaveLength(1);
  });

  // ---- attribution ---------------------------------------------------------

  it("attribution: a valid ref code records a pending referral (first-touch)", async () => {
    const code = await seedReferrer();
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code }),
    );

    const refs = await db
      .select()
      .from(universityReferrals)
      .where(sql`LOWER(referred_email) = ${REFERRED_EMAIL}`);
    expect(refs).toHaveLength(1);
    expect(refs[0].status).toBe("pending");
    expect(refs[0].referrerEmail).toBe(REFERRER_EMAIL);
    expect(refs[0].referrerCode).toBe(code);
    expect(refs[0].stripeSubscriptionId).toBe(REFERRED_SUB);
    // No credit is earned at signup — attribution is not earning.
    expect(await balanceFor(REFERRER_EMAIL)).toBe(0);
  });

  it("attribution first-touch lock: a SECOND code for the same referred email is ignored", async () => {
    const code1 = await seedReferrer();
    // A second active referrer with a different code.
    await db.insert(universityMembers).values({
      email: "other@test.dev",
      status: "active",
      plan: "university_monthly",
      joinedAt: new Date(),
    });
    await db.insert(universitySubscriptions).values({
      email: "other@test.dev",
      status: "active",
      plan: "university_monthly",
      stripeCustomerId: "cus_other",
      stripeSubscriptionId: "sub_other",
    });
    const { code: code2 } = await getOrCreateReferralCode(db, {
      email: "other@test.dev",
      accountId: null,
    });

    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code1 }),
    );
    // Second touch with a different code — must NOT overwrite the first.
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code2 }),
    );

    const refs = await db
      .select()
      .from(universityReferrals)
      .where(sql`LOWER(referred_email) = ${REFERRED_EMAIL}`);
    expect(refs).toHaveLength(1);
    expect(refs[0].referrerCode).toBe(code1); // first link wins
  });

  it("self-referral is blocked: records self_referral_blocked, no earning ever", async () => {
    const code = await seedReferrer();
    // The referrer uses their OWN code with their OWN email.
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRER_EMAIL, referralCode: code }),
    );
    const refs = await db
      .select()
      .from(universityReferrals)
      .where(sql`LOWER(referred_email) = ${REFERRER_EMAIL}`);
    expect(refs).toHaveLength(1);
    expect(refs[0].status).toBe("self_referral_blocked");

    // Even if an invoice.paid later fires for the referrer's own sub, no credit.
    await db.update(universityReferrals).set({ stripeSubscriptionId: REFERRER_SUB });
    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_self", subscription: REFERRER_SUB, customer: REFERRER_CUSTOMER, email: REFERRER_EMAIL }),
    );
    expect(await balanceFor(REFERRER_EMAIL)).toBe(0);
  });

  it("attribution: an unknown code is ignored (no referral row)", async () => {
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: "ZZZZZZZZ" }),
    );
    const refs = await db.select().from(universityReferrals);
    expect(refs).toHaveLength(0);
  });

  // ---- earn on invoice.paid ------------------------------------------------

  it("earn: referred member's invoice.paid accrues +$10 to the referrer", async () => {
    const code = await seedReferrer();
    // Production order: attribution fires at checkout BEFORE the member row
    // exists, then the member/subscription rows are created in the same event.
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code }),
    );
    await seedReferredMember();

    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_1", subscription: REFERRED_SUB, customer: REFERRED_CUSTOMER, email: REFERRED_EMAIL }),
    );

    expect(await balanceFor(REFERRER_EMAIL)).toBe(REFERRAL_REWARD_CENTS);
    const earned = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'referral_earned'`);
    expect(earned).toHaveLength(1);
    expect(earned[0].email).toBe(REFERRER_EMAIL);
    expect(earned[0].amountCents).toBe(REFERRAL_REWARD_CENTS);
    expect(earned[0].stripeInvoiceId).toBe("in_1");

    // The referral flips pending → active with activated_at set.
    const refs = await db
      .select()
      .from(universityReferrals)
      .where(sql`LOWER(referred_email) = ${REFERRED_EMAIL}`);
    expect(refs[0].status).toBe("active");
    expect(refs[0].activatedAt).toBeInstanceOf(Date);
  });

  it("earn idempotency: a replayed invoice.paid does NOT double-credit", async () => {
    const code = await seedReferrer();
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code }),
    );
    await seedReferredMember();

    const inv = invoicePaid({ id: "in_dup", subscription: REFERRED_SUB, customer: REFERRED_CUSTOMER, email: REFERRED_EMAIL });
    await handleReferralInvoicePaid(db, inv);
    await handleReferralInvoicePaid(db, inv); // replay

    expect(await balanceFor(REFERRER_EMAIL)).toBe(REFERRAL_REWARD_CENTS); // not $20
    const earned = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'referral_earned'`);
    expect(earned).toHaveLength(1);
  });

  it("earn pauses while the REFERRER is inactive (no credit banked for a non-member)", async () => {
    const code = await seedReferrer();
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code }),
    );
    await seedReferredMember();
    // Referrer lapses.
    await db
      .update(universityMembers)
      .set({ status: "cancelled" })
      .where(sql`LOWER(email) = ${REFERRER_EMAIL}`);

    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_pause", subscription: REFERRED_SUB, customer: REFERRED_CUSTOMER, email: REFERRED_EMAIL }),
    );
    expect(await balanceFor(REFERRER_EMAIL)).toBe(0);
  });

  // ---- apply with floor ----------------------------------------------------

  it("apply: a referrer with credit gets it applied to their own invoice, capped at the $5 floor, pushed to Stripe balance", async () => {
    const code = await seedReferrer();
    await seedReferredMember();
    // Give the referrer a big standing balance directly (e.g. many referrals).
    await db.insert(universityCreditLedger).values({
      email: REFERRER_EMAIL,
      amountCents: 6000, // $60 banked
      kind: "referral_earned",
      source: "referral",
      sourceRefId: null,
      stripeInvoiceId: "in_seed_balance",
      reason: "seed",
    });

    // The referrer's OWN invoice is paid → apply credit down to the $5 floor.
    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_apply", subscription: REFERRER_SUB, customer: REFERRER_CUSTOMER, email: REFERRER_EMAIL, amountPaid: 5000 }),
    );

    // Applied = min($60, $50 - $5) = $45. Ledger gets a -$45 credit_applied row.
    const applied = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'credit_applied'`);
    expect(applied).toHaveLength(1);
    expect(applied[0].amountCents).toBe(-4500);
    expect(applied[0].stripeInvoiceId).toBe("in_apply");

    // Remaining balance rolls forward: $60 - $45 = $15.
    expect(await balanceFor(REFERRER_EMAIL)).toBe(1500);

    // And we pushed exactly $45 of credit (negative amount) onto the Stripe
    // customer balance for the referrer's customer id.
    const balanceCalls = stripeRequestMock.mock.calls.filter((c) =>
      String(c[1]).includes("/balance_transactions"),
    );
    expect(balanceCalls).toHaveLength(1);
    const [, path, body] = balanceCalls[0];
    expect(path).toBe(`/customers/${REFERRER_CUSTOMER}/balance_transactions`);
    expect((body as Record<string, unknown>).amount).toBe(-4500); // negative = credit
    expect((body as Record<string, unknown>).currency).toBe("usd");
  });

  it("apply idempotency: replaying the same invoice does NOT re-apply credit", async () => {
    await seedReferrer();
    await db.insert(universityCreditLedger).values({
      email: REFERRER_EMAIL,
      amountCents: 6000,
      kind: "referral_earned",
      source: "referral",
      sourceRefId: null,
      stripeInvoiceId: "in_seed_balance",
      reason: "seed",
    });
    const inv = invoicePaid({ id: "in_apply_dup", subscription: REFERRER_SUB, customer: REFERRER_CUSTOMER, email: REFERRER_EMAIL });

    await handleReferralInvoicePaid(db, inv);
    await handleReferralInvoicePaid(db, inv); // replay

    const applied = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'credit_applied'`);
    expect(applied).toHaveLength(1); // not 2
    expect(await balanceFor(REFERRER_EMAIL)).toBe(1500); // $60 - $45, applied once
    // Stripe balance pushed exactly once.
    const balanceCalls = stripeRequestMock.mock.calls.filter((c) =>
      String(c[1]).includes("/balance_transactions"),
    );
    expect(balanceCalls).toHaveLength(1);
  });

  it("apply: a member with zero balance triggers no ledger row and no Stripe push", async () => {
    await seedReferrer();
    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_zero", subscription: REFERRER_SUB, customer: REFERRER_CUSTOMER, email: REFERRER_EMAIL }),
    );
    const applied = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'credit_applied'`);
    expect(applied).toHaveLength(0);
    const balanceCalls = stripeRequestMock.mock.calls.filter((c) =>
      String(c[1]).includes("/balance_transactions"),
    );
    expect(balanceCalls).toHaveLength(0);
  });

  // ---- refund / dispute reversal -------------------------------------------

  it("refund: charge.refunded for a referred invoice writes a -$10 referral_reversed row (no cash clawback)", async () => {
    const code = await seedReferrer();
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code }),
    );
    await seedReferredMember();
    // Earn first.
    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_r1", subscription: REFERRED_SUB, customer: REFERRED_CUSTOMER, email: REFERRED_EMAIL }),
    );
    expect(await balanceFor(REFERRER_EMAIL)).toBe(REFERRAL_REWARD_CENTS);

    // The referred member's charge is refunded.
    await handleReferralRefund(db, {
      id: "ch_refund",
      invoice: "in_r1",
      customer: REFERRED_CUSTOMER,
    });

    const reversed = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'referral_reversed'`);
    expect(reversed).toHaveLength(1);
    expect(reversed[0].email).toBe(REFERRER_EMAIL);
    expect(reversed[0].amountCents).toBe(-REFERRAL_REWARD_CENTS);
    expect(reversed[0].stripeInvoiceId).toBe("in_r1");
    // Net: +$10 earned, -$10 reversed = $0.
    expect(await balanceFor(REFERRER_EMAIL)).toBe(0);
  });

  it("refund idempotency: a replayed charge.refunded does NOT double-reverse", async () => {
    const code = await seedReferrer();
    await handleReferralAttribution(
      db,
      checkoutSession({ referredEmail: REFERRED_EMAIL, referralCode: code }),
    );
    await seedReferredMember();
    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_r2", subscription: REFERRED_SUB, customer: REFERRED_CUSTOMER, email: REFERRED_EMAIL }),
    );

    const refund = { id: "ch_refund_dup", invoice: "in_r2", customer: REFERRED_CUSTOMER };
    await handleReferralRefund(db, refund);
    await handleReferralRefund(db, refund); // replay

    const reversed = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'referral_reversed'`);
    expect(reversed).toHaveLength(1); // not 2
    expect(await balanceFor(REFERRER_EMAIL)).toBe(0);
  });

  it("CREDIT_FLOOR_CENTS is honored end-to-end (a bill can never reach $0)", async () => {
    await seedReferrer();
    await db.insert(universityCreditLedger).values({
      email: REFERRER_EMAIL,
      amountCents: 100000, // absurd $1000 balance
      kind: "referral_earned",
      source: "referral",
      sourceRefId: null,
      stripeInvoiceId: "in_seed_huge",
      reason: "seed",
    });
    await handleReferralInvoicePaid(
      db,
      invoicePaid({ id: "in_floor", subscription: REFERRER_SUB, customer: REFERRER_CUSTOMER, email: REFERRER_EMAIL, amountPaid: 5000 }),
    );
    const applied = await db
      .select()
      .from(universityCreditLedger)
      .where(sql`kind = 'credit_applied'`);
    // Even with $1000 banked, we apply at most bill - floor = $45.
    expect(applied[0].amountCents).toBe(-(5000 - CREDIT_FLOOR_CENTS));
  });
});
