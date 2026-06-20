// ---------------------------------------------------------------------------
// Coherent Ones University — referral WEBHOOK wiring integration test.
//
// Proves the dispatch wiring in routes/university-checkout.ts end-to-end through
// the REAL signed webhook on a REAL embedded Postgres:
//   - checkout.session.completed runs attribution BEFORE the member upsert, so a
//     legitimate new referred member is attributed (NOT blocked as an existing
//     member) and the member/subscription rows are still created.
//   - invoice.paid (the new handler) accrues the referrer's $10 credit.
//   - charge.refunded (the new handler) reverses it.
//   - signature verification is REAL (a tampered signature is rejected 400).
//   - a replayed invoice.paid does not double-credit.
//
// The single outbound Stripe call (customer balance_transactions) is mocked.
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const stripeRequestMock = vi.hoisted(() => vi.fn(async () => ({ id: "cbtxn_test" })));
vi.mock("../services/stripe-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    stripeRequest: stripeRequestMock,
    universityStripeKey: () => "sk_test_university",
  };
});
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
import { universityWebhookRouter } from "../routes/university-checkout.js";
import { getOrCreateReferralCode, REFERRAL_REWARD_CENTS } from "../services/university-referrals.js";

const COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
const WEBHOOK_SECRET = "whsec_test_university";

const REFERRER_EMAIL = "ref-owner@test.dev";
const REFERRED_EMAIL = "ref-friend@test.dev";
const REFERRED_SUB = "sub_referred_wh";
const REFERRED_CUSTOMER = "cus_referred_wh";

function signStripePayload(rawBody: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function postSignedWebhook(
  app: express.Express,
  event: unknown,
  { secret = WEBHOOK_SECRET }: { secret?: string } = {},
) {
  const rawBody = JSON.stringify(event);
  return request(app)
    .post("/api/university/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signStripePayload(rawBody, secret))
    .send(rawBody);
}

function checkoutEvent(code: string): unknown {
  return {
    id: "evt_checkout_referred",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_referred_wh",
        object: "checkout_session",
        customer: REFERRED_CUSTOMER,
        customer_email: REFERRED_EMAIL,
        customer_details: { email: REFERRED_EMAIL },
        subscription: REFERRED_SUB,
        client_reference_id: code,
        metadata: {
          product: "university",
          plan: "university_monthly",
          customerEmail: REFERRED_EMAIL,
          displayName: "Ref Friend",
          referral_code: code,
        },
      },
    },
  };
}

function invoicePaidEvent(): unknown {
  return {
    id: "evt_invoice_paid",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_wh_1",
        object: "invoice",
        subscription: REFERRED_SUB,
        customer: REFERRED_CUSTOMER,
        customer_email: REFERRED_EMAIL,
        amount_paid: 5000,
        billing_reason: "subscription_cycle",
      },
    },
  };
}

function chargeRefundedEvent(): unknown {
  return {
    id: "evt_charge_refunded",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_wh_refund",
        object: "charge",
        invoice: "in_wh_1",
        customer: REFERRED_CUSTOMER,
      },
    },
  };
}

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
    `Skipping university referral webhook test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("university referral webhook wiring (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET_UNIVERSITY = WEBHOOK_SECRET;
    process.env.TEAM_DASHBOARD_COMPANY_ID = COMPANY_ID;

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-referral-webhook-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-referral-webhook-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    await db
      .insert(companies)
      .values({ id: COMPANY_ID, name: "Coherence Daddy" })
      .onConflictDoNothing();

    app = express();
    app.use("/api/university", universityWebhookRouter(db));
    app.use(express.json());
  }, 60_000);

  afterEach(async () => {
    stripeRequestMock.mockClear();
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

  async function seedActiveReferrer(): Promise<string> {
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
      stripeCustomerId: "cus_ref_owner",
      stripeSubscriptionId: "sub_ref_owner",
    });
    const { code } = await getOrCreateReferralCode(db, {
      email: REFERRER_EMAIL,
      accountId: null,
    });
    return code;
  }

  async function balanceFor(email: string): Promise<number> {
    const rows = await db
      .select({ amount: universityCreditLedger.amountCents })
      .from(universityCreditLedger)
      .where(sql`LOWER(email) = ${email}`);
    return rows.reduce((s, r) => s + r.amount, 0);
  }

  it("signed checkout attributes a NEW referred member (not blocked) AND still creates the member", async () => {
    const code = await seedActiveReferrer();

    const res = await postSignedWebhook(app, checkoutEvent(code));
    expect(res.status).toBe(200);

    // Attribution recorded as pending (NOT self_referral_blocked) — proves
    // attribution ran before the member upsert.
    const refs = await db
      .select()
      .from(universityReferrals)
      .where(sql`LOWER(referred_email) = ${REFERRED_EMAIL}`);
    expect(refs).toHaveLength(1);
    expect(refs[0].status).toBe("pending");
    expect(refs[0].referrerEmail).toBe(REFERRER_EMAIL);

    // The referred member row was still created by handleUniversityCheckout.
    const members = await db
      .select()
      .from(universityMembers)
      .where(sql`LOWER(email) = ${REFERRED_EMAIL}`);
    expect(members).toHaveLength(1);
    expect(members[0].status).toBe("active");

    // No credit at signup.
    expect(await balanceFor(REFERRER_EMAIL)).toBe(0);
  });

  it("signed invoice.paid accrues the referrer credit; replay does not double-credit", async () => {
    const code = await seedActiveReferrer();
    await postSignedWebhook(app, checkoutEvent(code));

    const paid = await postSignedWebhook(app, invoicePaidEvent());
    expect(paid.status).toBe(200);
    expect(paid.body).toEqual({ received: true, type: "invoice.paid" });
    expect(await balanceFor(REFERRER_EMAIL)).toBe(REFERRAL_REWARD_CENTS);

    // Replay — Stripe re-delivers. No double credit.
    await postSignedWebhook(app, invoicePaidEvent());
    expect(await balanceFor(REFERRER_EMAIL)).toBe(REFERRAL_REWARD_CENTS);
  });

  it("signed charge.refunded reverses the referral credit", async () => {
    const code = await seedActiveReferrer();
    await postSignedWebhook(app, checkoutEvent(code));
    await postSignedWebhook(app, invoicePaidEvent());
    expect(await balanceFor(REFERRER_EMAIL)).toBe(REFERRAL_REWARD_CENTS);

    const refunded = await postSignedWebhook(app, chargeRefundedEvent());
    expect(refunded.status).toBe(200);
    expect(refunded.body).toEqual({ received: true, type: "charge.refunded" });
    expect(await balanceFor(REFERRER_EMAIL)).toBe(0);
  });

  it("rejects a tampered signature with 400 (real verification, nothing written)", async () => {
    const code = await seedActiveReferrer();
    const rawBody = JSON.stringify(checkoutEvent(code));
    const res = await request(app)
      .post("/api/university/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signStripePayload(rawBody, "whsec_wrong"))
      .send(rawBody);
    expect(res.status).toBe(400);
    const refs = await db.select().from(universityReferrals);
    expect(refs).toHaveLength(0);
  });
});
