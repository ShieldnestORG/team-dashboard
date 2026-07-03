import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Admin impersonation flow — unit-ish tests against an in-memory db stub.
//
// Covers:
//   1. mintNonce inserts a row with a 5-min expiry.
//   2. exchangeNonce burns the nonce, sets a cookie, returns viewingAs.
//   3. Second exchange of the same nonce → 401.
//   4. Exchange of an expired nonce → 401.
//   5. /admin-impersonate/end clears the cookie + logs end with duration_s.
//   6. requireNonImpersonating blocks credential writes under the cookie.
// ---------------------------------------------------------------------------

// Mock email + stripe like the existing portal-routes test.
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: vi.fn(),
  stripeConfigured: () => true,
}));

// Mock activity-log so we don't need the companies FK.
const loggedActivities: Array<Record<string, unknown>> = [];
vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
    loggedActivities.push(input);
  }),
}));

// PORTAL_SESSION_SECRET must be set before importing the service modules.
process.env.PORTAL_SESSION_SECRET = "x".repeat(64);
// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
// Pin PORTAL_BASE_URL so the guard's allowlist is deterministic here.
const TRUSTED_ORIGIN = "https://app.test.local";
process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;

import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import {
  adminImpersonationService,
  ADMIN_IMPERSONATION_COOKIE,
  issueImpersonationCookie,
  verifyImpersonationCookie,
} from "../services/admin-impersonation.js";
import {
  adminImpersonationNonces,
  customerAccounts,
} from "@paperclipai/db";
import { useLocalServer } from "./helpers/supertest-server.js";

// ---------------------------------------------------------------------------
// In-memory db stub. We model only the operations the impersonation service
// + portal routes actually issue: select/insert/update against the nonce
// table and customer_accounts.
// ---------------------------------------------------------------------------

interface NonceRow {
  nonce: string;
  adminActorId: string;
  adminActorLabel: string | null;
  targetAccountId: string;
  targetCustomerLabel: string | null;
  createdAt: Date;
  expiresAt: Date;
  burnedAt: Date | null;
}
interface AccountRow {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

interface State {
  nonces: NonceRow[];
  accounts: AccountRow[];
}

function makeDb(state: State) {
  function tableKey(t: unknown): string {
    if (t === adminImpersonationNonces) return "nonces";
    if (t === customerAccounts) return "accounts";
    return "unknown";
  }

  // Stash query-time predicates so update().where(...).returning() knows what
  // to match. Drizzle exposes opaque SQL objects from eq()/and()/isNull(),
  // so the test inspects only by table; the route only ever queries a single
  // row by nonce or account id, which we encode by inspecting the captured
  // values via vi.fn instrumentation below.
  //
  // To keep the stub small we cheat: select(...).from(table).where(...).limit
  // returns the matching row by current `_pendingMatchNonce` /
  // `_pendingMatchAccountId` if set. update() does the same for the burn.
  let pendingMatchNonce: string | null = null;
  let pendingMatchAccount: string | null = null;
  let pendingNowForBurn: Date | null = null;

  function selectImpl(_proj?: unknown) {
    return {
      from(table: unknown) {
        const t = tableKey(table);
        const chain: any = {
          where: (..._args: unknown[]) => {
            // Don't try to interpret drizzle SQL. Pull the most recent
            // captured matchers from helper setters.
            return chain;
          },
          leftJoin: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown[]) => void) => {
            if (t === "nonces") {
              if (pendingMatchNonce) {
                const found = state.nonces.find((n) => n.nonce === pendingMatchNonce);
                pendingMatchNonce = null;
                return resolve(found ? [found] : []);
              }
              return resolve(state.nonces);
            }
            if (t === "accounts") {
              if (pendingMatchAccount) {
                const found = state.accounts.find((a) => a.id === pendingMatchAccount);
                pendingMatchAccount = null;
                return resolve(found ? [found] : []);
              }
              return resolve(state.accounts);
            }
            return resolve([]);
          },
        };
        return chain;
      },
    };
  }

  function insertImpl(table: unknown) {
    const t = tableKey(table);
    return {
      values(payload: Record<string, unknown>) {
        if (t === "nonces") {
          state.nonces.push({
            nonce: String(payload.nonce),
            adminActorId: String(payload.adminActorId),
            adminActorLabel: (payload.adminActorLabel as string | null) ?? null,
            targetAccountId: String(payload.targetAccountId),
            targetCustomerLabel:
              (payload.targetCustomerLabel as string | null) ?? null,
            createdAt: new Date(),
            // Service passes a SQL `now() + interval` fragment (not a JS
            // Date) to sidestep a Neon-pooler Date-param bug. The stub
            // only ever needs a Date for in-memory comparisons, so we
            // synthesize one here from NONCE_TTL_MIN (5 min).
            expiresAt:
              payload.expiresAt instanceof Date
                ? payload.expiresAt
                : new Date(Date.now() + 5 * 60 * 1000),
            burnedAt: null,
          });
        }
        const handle: any = {
          returning: () => ({
            then: (resolve: (v: unknown[]) => void) => resolve([]),
          }),
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
        return handle;
      },
    };
  }

  function updateImpl(table: unknown) {
    const t = tableKey(table);
    let setPayload: Record<string, unknown> = {};
    return {
      set(payload: Record<string, unknown>) {
        setPayload = payload;
        return this;
      },
      where(..._args: unknown[]) {
        return this;
      },
      returning() {
        return {
          then: (resolve: (v: unknown[]) => void) => {
            if (t === "nonces") {
              // Single-use: find a row whose nonce matches the pending
              // matcher (set by the test before triggering), is unburned,
              // and not expired.
              const now = pendingNowForBurn ?? new Date();
              const row = state.nonces.find(
                (n) =>
                  n.nonce === pendingMatchNonce &&
                  n.burnedAt === null &&
                  n.expiresAt.getTime() > now.getTime(),
              );
              pendingMatchNonce = null;
              pendingNowForBurn = null;
              if (!row) return resolve([]);
              // burned_at is now a SQL `now()` fragment in prod; stub uses
              // a fresh Date for the in-memory representation.
              const burnedRaw = setPayload.burnedAt;
              row.burnedAt =
                burnedRaw instanceof Date ? burnedRaw : new Date();
              return resolve([row]);
            }
            return resolve([]);
          },
        };
      },
      then: (resolve: (v: unknown) => void) => resolve(undefined),
    };
  }

  return {
    state,
    setPendingNonceMatcher(nonce: string, now?: Date) {
      pendingMatchNonce = nonce;
      if (now) pendingNowForBurn = now;
    },
    setPendingAccountMatcher(id: string) {
      pendingMatchAccount = id;
    },
    select: selectImpl,
    insert: insertImpl,
    update: updateImpl,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_ACCT = "22222222-2222-2222-2222-222222222222";

function freshState(): State {
  return {
    nonces: [],
    accounts: [
      {
        id: TARGET_ACCT,
        email: "alice@example.com",
        stripeCustomerId: null,
        createdAt: new Date(),
        lastLoginAt: null,
      },
    ],
  };
}

function makeApp(stub: ReturnType<typeof makeDb>) {
  const app = express();
  app.use(express.json());
  app.use(portalRoutes(stub as any));
  app.use(errorHandler);
  return app;
}

const local = useLocalServer();

describe("admin-impersonation service", () => {
  beforeEach(() => {
    loggedActivities.length = 0;
  });

  it("mints a nonce with a 5-min expiry and inserts a row", async () => {
    const state = freshState();
    const stub = makeDb(state);
    const svc = adminImpersonationService(stub as any);
    const before = Date.now();
    const minted = await svc.mintNonce({
      adminActorId: ADMIN_ID,
      targetAccountId: TARGET_ACCT,
      targetCustomerLabel: "alice@example.com",
    });
    const expiryDelta = minted.expiresAt.getTime() - before;
    expect(expiryDelta).toBeGreaterThan(4 * 60 * 1000);
    expect(expiryDelta).toBeLessThan(6 * 60 * 1000);
    expect(minted.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(state.nonces).toHaveLength(1);
    expect(state.nonces[0].adminActorId).toBe(ADMIN_ID);
    expect(state.nonces[0].targetAccountId).toBe(TARGET_ACCT);
    expect(state.nonces[0].burnedAt).toBeNull();
  });

  it("exchangeNonce burns the row and returns a valid cookie", async () => {
    const state = freshState();
    const stub = makeDb(state);
    const svc = adminImpersonationService(stub as any);
    const minted = await svc.mintNonce({
      adminActorId: ADMIN_ID,
      targetAccountId: TARGET_ACCT,
    });
    stub.setPendingNonceMatcher(minted.nonce);
    stub.setPendingAccountMatcher(TARGET_ACCT);
    const result = await svc.exchangeNonce(minted.nonce);
    expect(result).not.toBeNull();
    expect(result!.session.adminActorId).toBe(ADMIN_ID);
    expect(result!.session.targetAccountId).toBe(TARGET_ACCT);
    expect(state.nonces[0].burnedAt).not.toBeNull();
    expect(result!.targetEmail).toBe("alice@example.com");

    // Round-trip the cookie
    const session = verifyImpersonationCookie(result!.cookieValue);
    expect(session).not.toBeNull();
    expect(session!.targetAccountId).toBe(TARGET_ACCT);
  });

  it("rejects a second exchange of the same nonce", async () => {
    const state = freshState();
    const stub = makeDb(state);
    const svc = adminImpersonationService(stub as any);
    const minted = await svc.mintNonce({
      adminActorId: ADMIN_ID,
      targetAccountId: TARGET_ACCT,
    });
    stub.setPendingNonceMatcher(minted.nonce);
    const first = await svc.exchangeNonce(minted.nonce);
    expect(first).not.toBeNull();
    // Row is now burned; second match must fail.
    stub.setPendingNonceMatcher(minted.nonce);
    const second = await svc.exchangeNonce(minted.nonce);
    expect(second).toBeNull();
  });

  it("rejects an exchange of an expired nonce", async () => {
    const state = freshState();
    const stub = makeDb(state);
    const svc = adminImpersonationService(stub as any);
    // Past expiry.
    state.nonces.push({
      nonce: "deadbeef",
      adminActorId: ADMIN_ID,
      adminActorLabel: null,
      targetAccountId: TARGET_ACCT,
      targetCustomerLabel: null,
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      expiresAt: new Date(Date.now() - 5 * 60 * 1000),
      burnedAt: null,
    });
    stub.setPendingNonceMatcher("deadbeef");
    const result = await svc.exchangeNonce("deadbeef");
    expect(result).toBeNull();
  });

  it("/admin-impersonate/end logs duration_s and clears the cookie", async () => {
    const state = freshState();
    const stub = makeDb(state);
    const app = makeApp(stub);
    // Issue a cookie with a known startedAt (10s ago).
    const startedAt = new Date(Date.now() - 10_000);
    const { value } = issueImpersonationCookie({
      adminActorId: ADMIN_ID,
      targetAccountId: TARGET_ACCT,
      now: startedAt,
    });
    const res = await request(local.via(app))
      .post("/admin-impersonate/end")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", `${ADMIN_IMPERSONATION_COOKIE}=${encodeURIComponent(value)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, ended: true });
    // Clearing cookie: max-age=0 present
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie ?? "");
    expect(raw).toMatch(/cd_portal_impersonation=/);
    expect(raw).toMatch(/Max-Age=0/);
    const endEvent = loggedActivities.find(
      (a) => a.action === "admin.impersonate.end",
    );
    expect(endEvent).toBeDefined();
    const details = endEvent!.details as Record<string, unknown>;
    expect(typeof details.duration_s).toBe("number");
    expect(details.duration_s as number).toBeGreaterThanOrEqual(9);
    expect(details.session_id).toBeDefined();
  });

  it("requireNonImpersonating blocks credential POST under impersonation", async () => {
    const state = freshState();
    const stub = makeDb(state);
    const app = makeApp(stub);
    const { value } = issueImpersonationCookie({
      adminActorId: ADMIN_ID,
      targetAccountId: TARGET_ACCT,
    });
    const res = await request(local.via(app))
      .post("/credentials")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", `${ADMIN_IMPERSONATION_COOKIE}=${encodeURIComponent(value)}`)
      .send({ kind: "ga4_property", value: "secret-token" });
    expect(res.status).toBe(403);
    expect(res.body.impersonating).toBe(true);
  });
});
