// ---------------------------------------------------------------------------
// university-admin BILLING handlers — stubbed-Stripe integration tests.
//
// Complements university-admin-auth.test.ts (which covers the fail-closed auth
// gate). This suite drives the cancel / reactivate / detail handlers against a
// REAL embedded Postgres (real member + subscription rows, real mounted route)
// with the outbound Stripe REST client STUBBED — no network, no live account.
//
// The state machine these tests pin down (see routes/university-admin.ts):
//   - cancel  → Stripe POST { cancel_at_period_end: true } (access kept through
//               the paid period; DB status is flipped later by the webhook).
//   - reactivate (undo while a cancel is pending) → Stripe POST
//               { cancel_at_period_end: false, pause_collection: "" }.
//   - reactivate on a FULLY-cancelled sub (Stripe "No such subscription") →
//               409 with an actionable message, NOT a 500.
//   - cancel/reactivate on a comped member (no stripe_subscription_id) → 409.
//   - GET detail surfaces the live cancelAtPeriodEnd and never leaks the raw
//     stripeCustomerId / stripeSubscriptionId.
//   - a non-uuid :id → 400 (not a Postgres-cast 500).
//
// The board-auth gate is exercised for real: we seed an authUsers row whose
// email is on UNIVERSITY_SESSION_ADMINS and set a board actor, so the request
// passes both auth layers the same way production does.
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable — mirrors
// university-webhook-integration.test.ts (fullChain / noPgvector / skip).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// Stub the outbound Stripe client so the billing handlers run without network.
// Per-test we override mockStripeRequest to model success / "No such
// subscription" / the live-subscription GET.
const mockStripeRequest = vi.hoisted(() => vi.fn());
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: mockStripeRequest,
  stripeConfigured: () => true,
  universityStripeKey: () => "rk_test_university",
}));

import {
  createDb,
  authUsers,
  universityMembers,
  universitySubscriptions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { universityAdminRoutes } from "../routes/university-admin.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const ADMIN_ID = "admin-user-1";
const ADMIN_EMAIL = "admin@test.dev";

// --- DB mode selection (mirrors university-webhook-integration.test.ts) ------
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
    `Skipping university-admin billing tests (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

const local = useLocalServer();

describeDb("university-admin billing handlers (stubbed Stripe)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  const ORIGINAL_ADMINS = process.env.UNIVERSITY_SESSION_ADMINS;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.UNIVERSITY_SESSION_ADMINS = ADMIN_EMAIL;
    process.env.NODE_ENV = "test";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-admin-billing-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-admin-billing-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // Seed the board admin whose email is on the allow-list so the real
    // two-layer auth gate passes.
    const now = new Date();
    await db
      .insert(authUsers)
      .values({
        id: ADMIN_ID,
        name: "Admin",
        email: ADMIN_EMAIL,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // Real Express app with a board actor injected (production sets this from a
    // real session/board key; the auth gate then does the allow-list check for
    // real against the seeded authUsers email).
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "board", userId: ADMIN_ID } as typeof req.actor;
      next();
    });
    app.use("/api/university-admin", universityAdminRoutes(db));
  }, 60_000);

  afterEach(async () => {
    mockStripeRequest.mockReset();
    await db.delete(universitySubscriptions);
    await db.delete(universityMembers);
  });

  afterAll(async () => {
    if (ORIGINAL_ADMINS === undefined) delete process.env.UNIVERSITY_SESSION_ADMINS;
    else process.env.UNIVERSITY_SESSION_ADMINS = ORIGINAL_ADMINS;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    await cleanup?.();
  });

  // Seed a member (+ optional subscription). Returns the member id.
  async function seedMember(opts: {
    status?: string;
    stripeSubscriptionId?: string | null;
    withSubscription?: boolean;
  }): Promise<string> {
    const memberId = randomUUID();
    const email = `m-${memberId.slice(0, 8)}@test.dev`;
    await db.insert(universityMembers).values({
      id: memberId,
      email,
      status: opts.status ?? "active",
      plan: "university_monthly",
    });
    if (opts.withSubscription !== false) {
      await db.insert(universitySubscriptions).values({
        memberId,
        email,
        status: opts.status ?? "active",
        plan: "university_monthly",
        stripeCustomerId: "cus_test",
        stripeSubscriptionId:
          opts.stripeSubscriptionId === undefined
            ? "sub_test_live"
            : opts.stripeSubscriptionId,
        currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
      });
    }
    return memberId;
  }

  it("cancel → Stripe POST with cancel_at_period_end: true", async () => {
    const memberId = await seedMember({ status: "active" });
    mockStripeRequest.mockResolvedValue({
      current_period_end: Math.floor(Date.now() / 1000) + 20 * 86_400,
    });

    const res = await request(local.via(app))
      .post(`/api/university-admin/members/${memberId}/cancel`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // The Stripe call scheduled cancel-at-period-end on this member's sub.
    expect(mockStripeRequest).toHaveBeenCalledWith(
      "POST",
      "/subscriptions/sub_test_live",
      { cancel_at_period_end: true },
      "rk_test_university",
    );
  });

  it("reactivate (undo a pending cancel) → Stripe POST cancel_at_period_end: false", async () => {
    const memberId = await seedMember({ status: "active" });
    mockStripeRequest.mockResolvedValue({});

    const res = await request(local.via(app))
      .post(`/api/university-admin/members/${memberId}/reactivate`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockStripeRequest).toHaveBeenCalledWith(
      "POST",
      "/subscriptions/sub_test_live",
      { cancel_at_period_end: false, pause_collection: "" },
      "rk_test_university",
    );
  });

  it("reactivate on a fully-cancelled subscription → 409, not 500", async () => {
    // DB still has the sub id, but Stripe has deleted the subscription.
    const memberId = await seedMember({ status: "cancelled" });
    mockStripeRequest.mockRejectedValue(
      new Error(
        "Stripe POST /subscriptions/sub_test_live failed: No such subscription: sub_test_live",
      ),
    );

    const res = await request(local.via(app))
      .post(`/api/university-admin/members/${memberId}/reactivate`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/must re-subscribe/i);
  });

  it("cancel a comped member (no stripe_subscription_id) → 409", async () => {
    const memberId = await seedMember({
      status: "active",
      stripeSubscriptionId: null,
    });

    const res = await request(local.via(app))
      .post(`/api/university-admin/members/${memberId}/cancel`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no stripe subscription/i);
    // No Stripe call was attempted.
    expect(mockStripeRequest).not.toHaveBeenCalled();
  });

  it("GET detail surfaces live cancelAtPeriodEnd and hides raw Stripe ids", async () => {
    const memberId = await seedMember({ status: "active" });
    // The live-subscription GET reports a pending cancel.
    mockStripeRequest.mockResolvedValue({
      cancel_at_period_end: true,
      current_period_end: Math.floor(Date.now() / 1000) + 10 * 86_400,
    });

    const res = await request(local.via(app)).get(
      `/api/university-admin/members/${memberId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.subscription.cancelAtPeriodEnd).toBe(true);
    // Raw Stripe ids must NOT be present in the client payload.
    expect(res.body.subscription.stripeCustomerId).toBeUndefined();
    expect(res.body.subscription.stripeSubscriptionId).toBeUndefined();
  });

  it("GET detail with a non-uuid id → 400 (not a Postgres-cast 500)", async () => {
    const res = await request(local.via(app)).get(
      "/api/university-admin/members/not-a-uuid",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid member id/i);
  });
});
