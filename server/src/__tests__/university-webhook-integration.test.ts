// ---------------------------------------------------------------------------
// Coherent Ones University — backend INTEGRATION test (no live Stripe, no net).
//
// Complements the 15 unit tests in university-stripe-handler.test.ts (which
// drive the handlers with a mocked query-builder). This proves the WHOLE
// activation chain end-to-end against a REAL embedded Postgres with the full
// migration chain applied (incl. 0107_customer_portal + 0122_coherent_ones_
// university), through the REAL mounted Express route, with a REAL Stripe
// signature that is verified for real (verifyStripeSignature is NOT bypassed).
//
// What this exercises (faithful, not stubbed):
//   - route:      POST /api/university/webhook on a real Express app, with the
//                 actual universityWebhookRouter(db) (express.raw before json,
//                 mirroring app.ts wiring).
//   - signature:  the raw body is signed here with the SAME scheme
//                 verifyStripeSignature expects — header `t=<ts>,v1=<hex>`,
//                 hex = HMAC-SHA256 over `${ts}.${rawBody}` with the secret in
//                 STRIPE_WEBHOOK_SECRET_UNIVERSITY. A bad-signature negative
//                 case asserts the 400 path also fires.
//   - DB:         a real Postgres. We assert the actual rows written:
//                 (a) university_members  (status active)
//                 (b) university_subscriptions (with stripe_subscription_id)
//                 (c) customer_accounts upsert (the customer-account-linker)
//   - resolver:   (d) getAccountWithEntitlements() returns entitlements.university
//                 with status active — and we go one step further and prove it
//                 surfaces on GET /api/portal/me through the real portalRoutes
//                 mount, authenticated with a real issueSession() cookie.
//   + idempotent replay (no duplicate rows on a second identical webhook)
//   + customer.subscription.deleted flips BOTH rows to cancelled
//
// Stubbed (and why):
//   - services/creditscore-email-callback.js — the magic-link email channel.
//     getAccountWithEntitlements does not send mail, but customer-portal.ts
//     imports the callback; we no-op it so no network is attempted anywhere.
//   - The activity_log insert (logUniversityActivity) writes to a real row.
//     activity_log.company_id is a NOT NULL FK to companies.id, so we seed a
//     companies row with the handler's TEAM_DASHBOARD_COMPANY_ID up front so
//     that path runs cleanly too (it is otherwise swallowed non-fatally).
//
// Skips cleanly (NO fake pass) if embedded Postgres / pgvector is unavailable
// in this environment — the migration chain depends on the vector extension
// (vector(1024) columns in earlier migrations). The skip prints its reason.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// The portal service imports the magic-link email callback at module load.
// No-op it so nothing touches the network (mirrors portal-routes.test.ts).
// Captured via vi.hoisted so the replay test can assert the welcome/receipt
// are sent ONCE per genuinely-new member and NOT re-sent on a webhook retry.
const { emailSpy } = vi.hoisted(() => ({ emailSpy: vi.fn(async () => undefined) }));
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: emailSpy,
}));

import {
  createDb,
  customerAccounts,
  universityMembers,
  universitySubscriptions,
  companies,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { universityWebhookRouter } from "../routes/university-checkout.js";
import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import { issueSession, PORTAL_SESSION_COOKIE } from "../services/customer-portal.js";

// The hard-coded company the handler logs activity against (see
// university-stripe-handler.ts COMPANY_ID). Seed it so the activity_log FK
// holds and that branch executes for real instead of being swallowed.
const COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const WEBHOOK_SECRET = "whsec_test_university";
const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars

const MEMBER_EMAIL = "member@test.dev";
const STRIPE_CUSTOMER = "cus_test_integration";
const STRIPE_SUBSCRIPTION = "sub_test_integration";
const CHECKOUT_SESSION = "cs_test_integration";

// --- Stripe signature: identical scheme to verifyStripeSignature ------------
// header: `t=<unixSeconds>,v1=<hexHmacSha256>` where the signed payload is
// `${t}.${rawBody}` and the key is the webhook secret.
function signStripePayload(rawBody: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const signedPayload = `${t}.${rawBody}`;
  const v1 = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${t},v1=${v1}`;
}

function checkoutCompletedEvent(): unknown {
  return {
    id: "evt_test_checkout_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: CHECKOUT_SESSION,
        object: "checkout_session",
        customer: STRIPE_CUSTOMER,
        customer_email: MEMBER_EMAIL,
        customer_details: { email: MEMBER_EMAIL },
        subscription: STRIPE_SUBSCRIPTION,
        metadata: {
          product: "university",
          plan: "university_monthly",
          customerEmail: MEMBER_EMAIL,
          displayName: "Test Member",
        },
      },
    },
  };
}

function subscriptionDeletedEvent(): unknown {
  return {
    id: "evt_test_subscription_deleted",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: STRIPE_SUBSCRIPTION,
        object: "subscription",
        status: "canceled",
      },
    },
  };
}

// POST a signed event to the real mounted /api/university/webhook.
async function postSignedWebhook(
  app: express.Express,
  event: unknown,
  { secret = WEBHOOK_SECRET }: { secret?: string } = {},
) {
  const rawBody = JSON.stringify(event);
  const signature = signStripePayload(rawBody, secret);
  return request(app)
    .post("/api/university/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signature)
    .send(rawBody); // supertest sends the string verbatim → express.raw sees it
}

// We can run against a real Postgres in two ways:
//   1. fullChain  — the standard harness is supported (pgvector present); apply
//                   the WHOLE production migration chain. Most faithful.
//   2. noPgvector — the standard harness is unsupported ONLY because pgvector is
//                   missing; fall back to replaying the migration files with the
//                   `vector(N)`→text shim (see helper). Still a real Postgres,
//                   real route, real signature, real DB rows — only the two
//                   unrelated embedding columns are shimmed.
// If Postgres itself can't start, we skip cleanly (NO fake pass).
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
    `Skipping university webhook integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university webhook integration test: pgvector unavailable — running against ` +
      `real Postgres with the vector(N)→text migration shim (university + portal ` +
      `tables are created from real DDL). Reason: ${support.reason ?? "unknown"}`,
  );
}

describeDb("university webhook → member + subscription + portal entitlement (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET_UNIVERSITY = WEBHOOK_SECRET;
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = "https://app.test.local";
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";
    process.env.TEAM_DASHBOARD_COMPANY_ID = COMPANY_ID;

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-webhook-integration-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-webhook-integration-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // Seed the company the activity logger references (NOT NULL FK).
    await db
      .insert(companies)
      .values({ id: COMPANY_ID, name: "Coherence Daddy" })
      .onConflictDoNothing();

    // Real Express app: webhook router mounted with its own raw body parser
    // BEFORE express.json (mirrors app.ts), then the portal routes under json.
    app = express();
    app.use("/api/university", universityWebhookRouter(db));
    app.use(express.json());
    app.use("/api/portal", portalRoutes(db));
    app.use(errorHandler);
  }, 60_000);

  afterEach(async () => {
    emailSpy.mockClear();
    // Order matters: subscription references member, member references account.
    await db.delete(universitySubscriptions);
    await db.delete(universityMembers);
    await db
      .delete(customerAccounts)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it("signed checkout.session.completed → member(active) + subscription + account + portal entitlement", async () => {
    const res = await postSignedWebhook(app, checkoutCompletedEvent());

    // Route accepted the signed event.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      received: true,
      type: "checkout.session.completed",
    });

    // (a) university_members row, status active.
    const members = await db
      .select()
      .from(universityMembers)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);
    expect(members).toHaveLength(1);
    expect(members[0].status).toBe("active");
    expect(members[0].plan).toBe("university_monthly");
    expect(members[0].displayName).toBe("Test Member");
    expect(members[0].joinedAt).toBeInstanceOf(Date);

    // (b) university_subscriptions row with the stripe_subscription_id.
    const subs = await db
      .select()
      .from(universitySubscriptions)
      .where(sql`stripe_subscription_id = ${STRIPE_SUBSCRIPTION}`);
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe("active");
    expect(subs[0].stripeCustomerId).toBe(STRIPE_CUSTOMER);
    expect(subs[0].stripeCheckoutSessionId).toBe(CHECKOUT_SESSION);
    expect(subs[0].email).toBe(MEMBER_EMAIL);
    // member_id was backfilled onto the subscription.
    expect(subs[0].memberId).toBe(members[0].id);

    // (c) customer_accounts upsert (the customer-account-linker fired).
    const accounts = await db
      .select()
      .from(customerAccounts)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].stripeCustomerId).toBe(STRIPE_CUSTOMER);
    // The account_id was resolved and threaded onto both product rows.
    expect(members[0].accountId).toBe(accounts[0].id);
    expect(subs[0].accountId).toBe(accounts[0].id);

    // (d) getAccountWithEntitlements surfaces university=active, AND it
    // surfaces over the REAL GET /api/portal/me route, authenticated with a
    // real session cookie (the same issueSession() the portal mints).
    const cookie = `${PORTAL_SESSION_COOKIE}=${issueSession(accounts[0].id)}`;
    const me = await request(app).get("/api/portal/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.account.email).toBe(MEMBER_EMAIL);
    expect(me.body.account.stripeCustomerId).toBe(STRIPE_CUSTOMER);
    expect(me.body.entitlements.university).not.toBeNull();
    expect(me.body.entitlements.university.status).toBe("active");
    expect(me.body.entitlements.university.plan).toBe("university_monthly");
    expect(me.body.entitlements.university.memberSince).toEqual(expect.any(String));
  });

  it("idempotent replay: a second identical signed webhook writes NO duplicate rows AND does not re-send emails", async () => {
    const first = await postSignedWebhook(app, checkoutCompletedEvent());
    expect(first.status).toBe(200);

    // First (genuinely new) activation sent exactly the welcome + receipt.
    const welcomeKinds = (kind: string) =>
      emailSpy.mock.calls.filter(
        (c) => (c[0] as { kind?: string } | undefined)?.kind === kind,
      ).length;
    expect(welcomeKinds("university_welcome")).toBe(1);
    expect(welcomeKinds("university_receipt")).toBe(1);

    const replay = await postSignedWebhook(app, checkoutCompletedEvent());
    expect(replay.status).toBe(200);

    const members = await db
      .select()
      .from(universityMembers)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);
    const subs = await db
      .select()
      .from(universitySubscriptions)
      .where(sql`stripe_subscription_id = ${STRIPE_SUBSCRIPTION}`);
    const accounts = await db
      .select()
      .from(customerAccounts)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);

    // The idempotency guarantee: one row each, no duplicates, still active.
    expect(members).toHaveLength(1);
    expect(subs).toHaveLength(1);
    expect(accounts).toHaveLength(1);
    expect(members[0].status).toBe("active");
    expect(subs[0].status).toBe("active");

    // EMAIL idempotency: the retry must NOT re-send — still exactly one of each
    // (a webhook retry double-sending welcome/receipt is the bug T2 fixes).
    expect(welcomeKinds("university_welcome")).toBe(1);
    expect(welcomeKinds("university_receipt")).toBe(1);
  });

  it("customer.subscription.deleted flips BOTH the member and the subscription to cancelled", async () => {
    // Activate first.
    const activate = await postSignedWebhook(app, checkoutCompletedEvent());
    expect(activate.status).toBe(200);

    // Then cancel via a signed deletion event for the same subscription.
    const cancel = await postSignedWebhook(app, subscriptionDeletedEvent());
    expect(cancel.status).toBe(200);
    expect(cancel.body).toEqual({
      received: true,
      type: "customer.subscription.deleted",
    });

    const members = await db
      .select()
      .from(universityMembers)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);
    const subs = await db
      .select()
      .from(universitySubscriptions)
      .where(sql`stripe_subscription_id = ${STRIPE_SUBSCRIPTION}`);

    expect(members).toHaveLength(1);
    expect(subs).toHaveLength(1);
    expect(members[0].status).toBe("cancelled");
    expect(subs[0].status).toBe("cancelled");
    expect(subs[0].canceledAt).toBeInstanceOf(Date);

    // And the portal no longer surfaces the entitlement (resolver filters to
    // active/past_due only).
    const accounts = await db
      .select()
      .from(customerAccounts)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);
    const cookie = `${PORTAL_SESSION_COOKIE}=${issueSession(accounts[0].id)}`;
    const me = await request(app).get("/api/portal/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.entitlements.university).toBeNull();
  });

  it("rejects a tampered signature with 400 (signature verification is real, not bypassed)", async () => {
    const event = checkoutCompletedEvent();
    const rawBody = JSON.stringify(event);
    // Sign with the WRONG secret → verifyStripeSignature must reject.
    const badSignature = signStripePayload(rawBody, "whsec_wrong_secret");
    const res = await request(app)
      .post("/api/university/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", badSignature)
      .send(rawBody);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid Stripe signature" });

    // Nothing was written.
    const members = await db
      .select()
      .from(universityMembers)
      .where(sql`LOWER(email) = ${MEMBER_EMAIL}`);
    expect(members).toHaveLength(0);
  });
});
