// ---------------------------------------------------------------------------
// University billing save-flow route tests — POST /university/{cancel,pause,
// reactivate}.
//
// Style mirrors portal-routes.test.ts (mocked stripe-client + table-routed db
// stub) and the queue-assert discipline of university-stripe-handler.test.ts.
// We assert, for each route:
//   1. the right Stripe params (cancel_at_period_end / pause_collection /
//      reactivate), against the SEPARATE University (Starwise) key,
//   2. the documented response shape (status + accessUntil/resumesAt ISO),
//   3. cancel persists the optional reason (recordCancelFeedback insert),
//   4. a non-member session gets 403 and NO Stripe call.
//
// No live Stripe: stripeRequest is fully mocked. No embedded Postgres: the db
// is an in-memory stub routed by table reference.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the email callback so any magic-link send is a no-op (unused here).
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));

// Mock stripe-client. stripeRequest is asserted on; universityStripeKey()
// returns a sentinel so we can prove the SEPARATE Starwise key is passed.
const mockStripeRequest = vi.hoisted(() => vi.fn());
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: mockStripeRequest,
  stripeConfigured: () => true,
  universityStripeKey: () => "rk_test_university",
}));

import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import {
  PORTAL_SESSION_COOKIE,
  issueSession,
} from "../services/customer-portal.js";
import {
  customerAccounts,
  customerActionLog,
  universityMembers,
  universitySubscriptions,
  universityCancelFeedback,
} from "@paperclipai/db";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
// Must match the PORTAL_BASE_URL this suite sets in beforeAll.
const TRUSTED_ORIGIN = "https://app.test.local";
const EMAIL = "member@example.com";
const SUB_ID = "sub_test_university_123";
// Fixed period end so the ISO assertion is deterministic.
const PERIOD_END_UNIX = 1_900_000_000; // 2030-03-17T18:46:40.000Z

interface State {
  accounts: Array<{ id: string; email: string; stripeCustomerId: string | null }>;
  members: Array<{ id: string }>;
  subscriptions: Array<{ stripeSubscriptionId: string | null }>;
  cancelFeedback: Array<{ accountId: string | null; email: string; reason: string | null }>;
  actionLog: Array<{ accountId: string | null; kind: string }>;
}

function tableKey(t: unknown): string {
  if (t === customerAccounts) return "accounts";
  if (t === universityMembers) return "members";
  if (t === universitySubscriptions) return "subscriptions";
  if (t === universityCancelFeedback) return "cancelFeedback";
  if (t === customerActionLog) return "actionLog";
  return "unknown";
}

function makeDb(state: State) {
  function selectImpl(_proj?: unknown) {
    return {
      from(_table: unknown) {
        const table = tableKey(_table);
        const chain: any = {
          where: () => chain,
          orderBy: () => chain,
          leftJoin: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) => {
            try {
              if (table === "accounts") return resolve(state.accounts as unknown[]);
              if (table === "members") return resolve(state.members as unknown[]);
              if (table === "subscriptions") {
                return resolve(
                  state.subscriptions.map((s) => ({
                    stripeSubscriptionId: s.stripeSubscriptionId,
                  })) as unknown[],
                );
              }
              return resolve([]);
            } catch (err) {
              reject?.(err);
            }
          },
        };
        return chain;
      },
    };
  }

  function insertImpl(_table: unknown) {
    const name = tableKey(_table);
    return {
      values(payload: Record<string, unknown>) {
        if (name === "cancelFeedback") {
          state.cancelFeedback.push({
            accountId: (payload.accountId as string | null) ?? null,
            email: String(payload.email),
            reason: (payload.reason as string | null) ?? null,
          });
        } else if (name === "actionLog") {
          state.actionLog.push({
            accountId: (payload.accountId as string | null) ?? null,
            kind: String(payload.kind),
          });
        }
        const handle: any = {
          returning: () => ({ then: (resolve: (v: unknown[]) => void) => resolve([]) }),
          then: (resolve: () => void) => resolve(),
        };
        return handle;
      },
    };
  }

  return {
    select: selectImpl,
    insert: insertImpl,
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

function freshState(overrides: Partial<State> = {}): State {
  return {
    accounts: [{ id: ACCOUNT_ID, email: EMAIL, stripeCustomerId: null }],
    members: [{ id: "member-row-1" }],
    subscriptions: [{ stripeSubscriptionId: SUB_ID }],
    cancelFeedback: [],
    actionLog: [],
    ...overrides,
  };
}

function buildApp(state: State) {
  const app = express();
  app.use(express.json());
  app.use("/api/portal", portalRoutes(makeDb(state) as any));
  app.use(errorHandler);
  return app;
}

function authCookie(): string {
  return `${PORTAL_SESSION_COOKIE}=${issueSession(ACCOUNT_ID)}`;
}

describe("portal university billing save-flow routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PORTAL_SESSION_SECRET =
      "test-test-test-test-test-test-test-test-test-test-secret";
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development";
    process.env.PORTAL_COOKIE_DOMAIN = "";
  });

  it("POST /university/cancel sets cancel_at_period_end via the University key, persists the reason, and returns canceling + accessUntil", async () => {
    const state = freshState();
    const app = buildApp(state);
    mockStripeRequest.mockResolvedValueOnce({ current_period_end: PERIOD_END_UNIX });

    const res = await request(app)
      .post("/api/portal/university/cancel")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", authCookie())
      .send({ reason: "too busy this month" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "canceling",
      accessUntil: new Date(PERIOD_END_UNIX * 1000).toISOString(),
    });

    // Stripe called once: POST /subscriptions/<id> with cancel_at_period_end
    // and the SEPARATE University (Starwise) key.
    expect(mockStripeRequest).toHaveBeenCalledTimes(1);
    const [method, path, body, key] = mockStripeRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe(`/subscriptions/${SUB_ID}`);
    expect(body).toEqual({ cancel_at_period_end: true });
    expect(key).toBe("rk_test_university");

    // Reason persisted, attributed to the account + email.
    expect(state.cancelFeedback).toHaveLength(1);
    expect(state.cancelFeedback[0]).toMatchObject({
      accountId: ACCOUNT_ID,
      email: EMAIL,
      reason: "too busy this month",
    });
  });

  it("POST /university/cancel with no reason persists null reason and still cancels", async () => {
    const state = freshState();
    const app = buildApp(state);
    mockStripeRequest.mockResolvedValueOnce({ current_period_end: PERIOD_END_UNIX });

    const res = await request(app)
      .post("/api/portal/university/cancel")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", authCookie())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("canceling");
    expect(state.cancelFeedback).toHaveLength(1);
    expect(state.cancelFeedback[0].reason).toBeNull();
  });

  it("POST /university/pause sets pause_collection void with a resumes_at ~1 month out and returns paused + resumesAt", async () => {
    const state = freshState();
    const app = buildApp(state);
    mockStripeRequest.mockResolvedValueOnce({});

    const before = Date.now();
    const res = await request(app)
      .post("/api/portal/university/pause")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", authCookie())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paused");
    const resumesAtMs = new Date(res.body.resumesAt).getTime();
    // ~1 month out: between 28 and 31 days from now.
    const days = (resumesAtMs - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);

    expect(mockStripeRequest).toHaveBeenCalledTimes(1);
    const [method, path, body, key] = mockStripeRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe(`/subscriptions/${SUB_ID}`);
    expect((body as any).pause_collection.behavior).toBe("void");
    expect(typeof (body as any).pause_collection.resumes_at).toBe("number");
    // resumes_at (unix seconds) must match the returned ISO.
    expect((body as any).pause_collection.resumes_at).toBe(
      Math.floor(resumesAtMs / 1000),
    );
    expect(key).toBe("rk_test_university");
  });

  it("POST /university/reactivate unsets cancel_at_period_end and clears pause_collection, returns active", async () => {
    const state = freshState();
    const app = buildApp(state);
    mockStripeRequest.mockResolvedValueOnce({});

    const res = await request(app)
      .post("/api/portal/university/reactivate")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", authCookie());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "active" });

    expect(mockStripeRequest).toHaveBeenCalledTimes(1);
    const [method, path, body, key] = mockStripeRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe(`/subscriptions/${SUB_ID}`);
    expect(body).toEqual({ cancel_at_period_end: false, pause_collection: "" });
    expect(key).toBe("rk_test_university");
  });

  it("returns 403 and makes NO Stripe call when the session is not a University member", async () => {
    // No university_members row → isUniversityAccount() is false.
    const state = freshState({ members: [] });
    const app = buildApp(state);

    const res = await request(app)
      .post("/api/portal/university/cancel")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", authCookie())
      .send({ reason: "x" });

    expect(res.status).toBe(403);
    expect(mockStripeRequest).not.toHaveBeenCalled();
    expect(state.cancelFeedback).toHaveLength(0);
  });

  it("returns 401 and makes NO Stripe call without a session cookie", async () => {
    const state = freshState();
    const app = buildApp(state);
    const res = await request(app)
      .post("/api/portal/university/pause")
      .set("Origin", TRUSTED_ORIGIN)
      .send({});
    expect(res.status).toBe(401);
    expect(mockStripeRequest).not.toHaveBeenCalled();
  });

  it("returns 400 when the member has no recorded University subscription", async () => {
    const state = freshState({ subscriptions: [] });
    const app = buildApp(state);
    const res = await request(app)
      .post("/api/portal/university/reactivate")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", authCookie());
    expect(res.status).toBe(400);
    expect(mockStripeRequest).not.toHaveBeenCalled();
  });
});
