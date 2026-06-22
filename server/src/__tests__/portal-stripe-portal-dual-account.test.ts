// ---------------------------------------------------------------------------
// /api/portal/stripe-portal — per-account customer-id selection (integration).
//
// Coherent Ones University bills on a SEPARATE Stripe account (Starwise) from
// the shared Coherence Daddy account (CreditScore/Watchtower). The billing
// portal must therefore create the session with a key+customer-id pair that
// come from the SAME account, or Stripe rejects it ("No such customer").
//
// The edge this proves fixed: customer_accounts has a SINGLE stripe_customer_id
// column and the customer-account-linker upserts ON CONFLICT(email) DO UPDATE
// (last-writer-wins). A customer who holds BOTH a University (Starwise) and a
// CD (CreditScore/Watchtower) subscription therefore has whichever product's
// webhook fired last stored there. Before the fix, /stripe-portal picked the
// University key but sent that ambiguous column value as the customer — which
// for a dual customer could be the CD customer id → wrong account → error.
//
// The fix: for a University account the customer id is read from
// university_subscriptions (written only by the University checkout, which
// authenticates with universityStripeKey()), so the key and id always share an
// account. CD-only accounts are untouched.
//
// Real embedded Postgres + the full migration chain + the REAL mounted
// portalRoutes. Only stripe-client is mocked — we capture the exact
// (customer, secretKey) the route sends without hitting the network. Skips
// cleanly (NO fake pass) when embedded Postgres is unavailable.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// No-op the magic-link email channel (customer-portal imports it at load).
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));

// Capture every outbound Stripe call. The route imports exactly these three
// from stripe-client; universityStripeKey() returns a sentinel so we can assert
// WHICH account key the route picked.
const UNIVERSITY_KEY = "sk_test_starwise_university_sentinel";
const mockStripeRequest = vi.hoisted(() => vi.fn());
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: mockStripeRequest,
  stripeConfigured: () => true,
  universityStripeKey: () => UNIVERSITY_KEY,
}));

import {
  createDb,
  customerAccounts,
  universityMembers,
  universitySubscriptions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import { issueSession, PORTAL_SESSION_COOKIE } from "../services/customer-portal.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars

// Real embedded Postgres, two ways (see university-webhook-integration.test.ts):
//   fullChain  — pgvector present, apply the whole production migration chain.
//   noPgvector — pgvector missing; replay migrations with the vector(N)→text
//                shim (university + portal tables still real DDL).
// If Postgres itself can't start, skip cleanly.
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
    `Skipping /stripe-portal dual-account test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("/api/portal/stripe-portal per-account customer-id selection (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = "https://app.test.local";
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase("portal-dual-account-");
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase("portal-dual-account-novec-");
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    app = express();
    app.use(express.json());
    app.use("/api/portal", portalRoutes(db));
    app.use(errorHandler);
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeRequest.mockResolvedValue({ url: "https://billing.stripe.test/session" });
  });

  afterEach(async () => {
    // FK order: subscription → member → account.
    await db.delete(universitySubscriptions);
    await db.delete(universityMembers);
    await db.delete(customerAccounts);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  // Seed a customer_accounts row; optionally a University member + subscription.
  async function seed(opts: {
    email: string;
    accountStripeCustomerId: string | null;
    university?: { subscriptionStripeCustomerId: string | null };
  }): Promise<string> {
    const email = opts.email.toLowerCase();
    const [account] = await db
      .insert(customerAccounts)
      .values({ email, stripeCustomerId: opts.accountStripeCustomerId })
      .returning({ id: customerAccounts.id });
    const accountId = account!.id;

    if (opts.university) {
      const [member] = await db
        .insert(universityMembers)
        .values({ email, accountId, status: "active", plan: "university_monthly" })
        .returning({ id: universityMembers.id });
      await db.insert(universitySubscriptions).values({
        email,
        accountId,
        memberId: member!.id,
        status: "active",
        plan: "university_monthly",
        stripeCustomerId: opts.university.subscriptionStripeCustomerId,
        stripeSubscriptionId: `sub_${accountId}`,
      });
    }
    return accountId;
  }

  function callPortal(accountId: string) {
    const cookie = `${PORTAL_SESSION_COOKIE}=${issueSession(accountId)}`;
    return request(app).post("/api/portal/stripe-portal").set("Cookie", cookie);
  }

  it("DUAL customer: uses the Starwise customer id + University key, NOT the poisoned shared column", async () => {
    // CD webhook fired last → customer_accounts.stripe_customer_id holds the CD
    // customer id (the poison). The Starwise id lives on university_subscriptions.
    const accountId = await seed({
      email: "dual@test.dev",
      accountStripeCustomerId: "cus_cd_fired_last", // CD-account customer (poison)
      university: { subscriptionStripeCustomerId: "cus_starwise_member" },
    });

    const res = await callPortal(accountId);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://billing.stripe.test/session");

    expect(mockStripeRequest).toHaveBeenCalledTimes(1);
    const [method, path, body, secretKey] = mockStripeRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/billing_portal/sessions");
    // The fix: Starwise customer id from university_subscriptions, NOT the
    // CD customer id that last-writer-wins left in customer_accounts.
    expect(body.customer).toBe("cus_starwise_member");
    expect(body.customer).not.toBe("cus_cd_fired_last");
    // ...paired with the University (Starwise) key.
    expect(secretKey).toBe(UNIVERSITY_KEY);
  });

  it("CD-only customer: unchanged — shared key + customer_accounts.stripe_customer_id", async () => {
    const accountId = await seed({
      email: "cd-only@test.dev",
      accountStripeCustomerId: "cus_cd_only",
    });

    const res = await callPortal(accountId);
    expect(res.status).toBe(200);

    expect(mockStripeRequest).toHaveBeenCalledTimes(1);
    const [, , body, secretKey] = mockStripeRequest.mock.calls[0];
    expect(body.customer).toBe("cus_cd_only");
    // undefined → stripe-client falls back to the shared STRIPE_SECRET_KEY.
    expect(secretKey).toBeUndefined();
  });

  it("University-only customer: Starwise customer id + University key", async () => {
    const accountId = await seed({
      email: "uni-only@test.dev",
      // Today the University webhook also writes the Starwise id here; the route
      // no longer depends on it for University accounts, but seed it to mirror
      // production and prove the behaviour is identical (no regression).
      accountStripeCustomerId: "cus_starwise_only",
      university: { subscriptionStripeCustomerId: "cus_starwise_only" },
    });

    const res = await callPortal(accountId);
    expect(res.status).toBe(200);

    const [, , body, secretKey] = mockStripeRequest.mock.calls[0];
    expect(body.customer).toBe("cus_starwise_only");
    expect(secretKey).toBe(UNIVERSITY_KEY);
  });

  it("University account with no captured Starwise customer id → 400 (never mis-bills via the shared column)", async () => {
    // Member exists but the subscription never captured a customer id. We must
    // NOT silently fall back to the CD-account id sitting in customer_accounts.
    const accountId = await seed({
      email: "uni-no-cus@test.dev",
      accountStripeCustomerId: "cus_cd_fired_last",
      university: { subscriptionStripeCustomerId: null },
    });

    const res = await callPortal(accountId);
    expect(res.status).toBe(400);
    expect(mockStripeRequest).not.toHaveBeenCalled();
  });
});
