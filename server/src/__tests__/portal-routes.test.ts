import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the email callback so the magic-link send is a no-op in tests.
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));

// Mock stripe-client so /stripe-portal can be exercised without network.
const mockStripeRequest = vi.hoisted(() => vi.fn());
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: mockStripeRequest,
  stripeConfigured: () => true,
  // /stripe-portal now resolves a per-account key (University → Starwise).
  // None of these tests exercise that path, but mock it to match the module
  // surface the route imports.
  universityStripeKey: () => "rk_test_university",
}));

import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import { useLocalServer } from "./helpers/supertest-server.js";
import { PORTAL_SESSION_COOKIE } from "../services/customer-portal.js";
import {
  customerAccounts,
  customerActionLog,
  customerCredentials,
  customerMagicLinks,
  creditscoreSubscriptions,
  bundleSubscriptions,
} from "@paperclipai/db";

// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
// Must match the PORTAL_BASE_URL this suite sets in beforeAll.
const TRUSTED_ORIGIN = "https://app.test.local";

// ---------------------------------------------------------------------------
// In-memory db stub. Drizzle's chained query builders are awaitable thenables;
// we model that with promise-returning chains. Each test overrides the
// underlying state via the closures captured below.
// ---------------------------------------------------------------------------

interface MagicLinkRow {
  token: string;
  email: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}
interface AccountRow {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

interface State {
  links: MagicLinkRow[];
  accounts: AccountRow[];
  actionLog: Array<{ accountId: string | null; kind: string }>;
}

function makeDb(state: State) {
  // Each select() returns a chain. The chain is awaitable at any point and
  // returns the matching subset of `state`. The matchers below are minimal —
  // they only need to support the actual queries our service issues.

  function tableKey(t: unknown): string {
    if (t === customerMagicLinks) return "links";
    if (t === customerAccounts) return "accounts";
    if (t === customerCredentials) return "credentials";
    if (t === customerActionLog) return "actionLog";
    if (t === creditscoreSubscriptions) return "subs";
    if (t === bundleSubscriptions) return "bundles";
    return "unknown";
  }

  function selectImpl(_proj?: unknown) {
    return {
      from(_table: unknown) {
        const table = tableKey(_table);
        const chain: any = {
          where: () => chain,
          leftJoin: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) => {
            try {
              if (table === "links") return resolve(state.links as unknown[]);
              if (table === "accounts") return resolve(state.accounts as unknown[]);
              if (table === "credentials") return resolve([]);
              if (table === "subs") return resolve([]);
              if (table === "bundles") return resolve([]);
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
        // Apply side-effect immediately so both `await db.insert(...).values(...)`
        // and `await db.insert(...).values(...).returning()` flows write state.
        if (name === "links") {
          state.links.push({
            token: String(payload.token),
            email: String(payload.email),
            expiresAt: payload.expiresAt as Date,
            consumedAt: null,
            createdAt: new Date(),
          });
        } else if (name === "actionLog") {
          state.actionLog.push({
            accountId: (payload.accountId as string | null) ?? null,
            kind: String(payload.kind),
          });
        }
        const handle: any = {
          returning: () => ({
            then: (resolve: (v: unknown[]) => void) => {
              if (name === "accounts") {
                const row: AccountRow = {
                  id: `acc-${state.accounts.length + 1}`,
                  email: String(payload.email),
                  stripeCustomerId: null,
                  createdAt: new Date(),
                  lastLoginAt: payload.lastLoginAt as Date | null,
                };
                state.accounts.push(row);
                return resolve([row]);
              }
              return resolve([]);
            },
          }),
          then: (resolve: () => void) => resolve(),
        };
        return handle;
      },
    };
  }

  function updateImpl(_table: unknown) {
    const name = tableKey(_table);
    return {
      set(patch: Record<string, unknown>) {
        return {
          where() {
            const handle: any = {
              returning: () => ({
                then: (resolve: (v: unknown[]) => void) => {
                  if (name === "links") {
                    // Mark all unconsumed links as consumed (test-shape proxy
                    // for the and(token=, consumedAt IS NULL) where-clause).
                    const unconsumed = state.links.filter((l) => !l.consumedAt);
                    for (const l of unconsumed) {
                      l.consumedAt = (patch.consumedAt as Date) ?? new Date();
                    }
                    return resolve(unconsumed);
                  }
                  return resolve([]);
                },
              }),
              then: (resolve: () => void) => {
                if (name === "accounts") {
                  for (const a of state.accounts) {
                    if (patch.lastLoginAt) a.lastLoginAt = patch.lastLoginAt as Date;
                    if (patch.stripeCustomerId !== undefined) {
                      a.stripeCustomerId = patch.stripeCustomerId as string | null;
                    }
                  }
                }
                resolve();
              },
            };
            return handle;
          },
        };
      },
    };
  }

  return {
    select: selectImpl,
    insert: insertImpl,
    update: updateImpl,
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

function buildApp(db: ReturnType<typeof makeDb>) {
  const app = express();
  app.use(express.json());
  app.use("/api/portal", portalRoutes(db as any));
  app.use(errorHandler);
  return app;
}

const local = useLocalServer();

describe("portal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PORTAL_SESSION_SECRET =
      "test-test-test-test-test-test-test-test-test-test-secret";
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    delete process.env.PORTAL_COOKIE_DOMAIN;
    process.env.PORTAL_COOKIE_DOMAIN = ""; // suppress Domain= for supertest
  });

  it("POST /login persists a magic-link row and returns ok", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const app = buildApp(makeDb(state));
    const res = await request(local.via(app))
      .post("/api/portal/login")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ email: "user@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(state.links).toHaveLength(1);
    expect(state.links[0].email).toBe("user@example.com");
    expect(state.links[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("POST /login rejects malformed emails with 400", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const app = buildApp(makeDb(state));
    const res = await request(local.via(app))
      .post("/api/portal/login")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(state.links).toHaveLength(0);
  });

  it("GET /auth previews a valid token without consuming it (interstitial)", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const db = makeDb(state);
    const app = buildApp(db);

    state.links.push({
      token: "tok-abc",
      email: "alice@example.com",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const res = await request(local.via(app)).get("/api/portal/auth?token=tok-abc");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('action="/api/portal/auth?token=tok-abc"');
    expect(res.text).toContain('method="POST"');
    // CRITICAL: GET must NOT consume the token — that's the whole point of
    // the two-step flow (inbox/AV scanners follow GETs).
    expect(state.links[0].consumedAt).toBeNull();
    expect(state.accounts).toHaveLength(0);
  });

  it("POST /auth consumes the token, sets a cookie, and 302s", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const db = makeDb(state);
    const app = buildApp(db);

    state.links.push({
      token: "tok-abc",
      email: "alice@example.com",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const res = await request(local.via(app))
      .post("/api/portal/auth?token=tok-abc")
      .set("Origin", TRUSTED_ORIGIN);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("https://app.test.local/");
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(
      cookies.some((c) => typeof c === "string" && c.startsWith(`${PORTAL_SESSION_COOKIE}=`)),
    ).toBe(true);
    expect(state.links[0].consumedAt).not.toBeNull();
    expect(state.accounts).toHaveLength(1);
  });

  it("GET /auth with an unknown token redirects with error param", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const app = buildApp(makeDb(state));
    const res = await request(local.via(app)).get("/api/portal/auth?token=does-not-exist");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toContain("error=invalid_or_expired");
  });

  it("GET /auth with a consumed token redirects with the same uniform error", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const app = buildApp(makeDb(state));
    state.links.push({
      token: "tok-used",
      email: "alice@example.com",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await request(local.via(app)).get("/api/portal/auth?token=tok-used");
    expect(res.status).toBe(302);
    // Uniform error — no token-existence oracle.
    expect(res.headers["location"]).toContain("error=invalid_or_expired");
  });

  it("POST /auth a second time fails (single-use)", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const app = buildApp(makeDb(state));
    state.links.push({
      token: "tok-once",
      email: "alice@example.com",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: new Date(),
    });
    const first = await request(local.via(app))
      .post("/api/portal/auth?token=tok-once")
      .set("Origin", TRUSTED_ORIGIN);
    expect(first.headers["location"]).toBe("https://app.test.local/");
    const second = await request(local.via(app))
      .post("/api/portal/auth?token=tok-once")
      .set("Origin", TRUSTED_ORIGIN);
    expect(second.headers["location"]).toContain("error=invalid_or_expired");
  });

  it("GET /me returns 401 without a cookie", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const app = buildApp(makeDb(state));
    const res = await request(local.via(app)).get("/api/portal/me");
    expect(res.status).toBe(401);
  });

  it("GET /me returns the account when authenticated end-to-end", async () => {
    const state: State = { links: [], accounts: [], actionLog: [] };
    const db = makeDb(state);
    const app = buildApp(db);

    // Seed link, consume via /auth to obtain the cookie.
    state.links.push({
      token: "tok-zzz",
      email: "bob@example.com",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: new Date(),
    });
    const auth = await request(local.via(app))
      .post("/api/portal/auth?token=tok-zzz")
      .set("Origin", TRUSTED_ORIGIN);
    const setCookieHeader = auth.headers["set-cookie"];
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const sessionCookie = cookies
      .map((c) => (typeof c === "string" ? c.split(";")[0] : null))
      .find((c) => c && c.startsWith(`${PORTAL_SESSION_COOKIE}=`));
    expect(sessionCookie).toBeTruthy();

    const me = await request(local.via(app))
      .get("/api/portal/me")
      .set("Cookie", sessionCookie as string);
    expect(me.status).toBe(200);
    expect(me.body.account.email).toBe("bob@example.com");
    expect(me.body.entitlements).toEqual({ creditscore: null, bundles: [], watchtower: null, university: null });
  });
});
