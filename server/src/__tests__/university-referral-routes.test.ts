// ---------------------------------------------------------------------------
// Coherent Ones University — REFERRAL portal API route tests (Phase 2).
//
// GET /api/portal/university/referral is the single endpoint the member-area
// referrals page reads. It must:
//   - require a valid portal session (401 otherwise)
//   - require University membership (403 otherwise) — mirrors the
//     requireUniversityMember gate on the other /university/* routes
//   - lazily create the member's referral code on first call (Phase-1
//     getOrCreateReferralCode), and return the SAME code on repeat calls
//   - return the shareable join URL (https://coherencedaddy.com/university?ref=CODE)
//   - return the member's current credit balance = SUM(ledger.amount_cents)
//   - return the member's referrals (masked email, status, monthly earnings,
//     since)
//
// In-memory db stub in the style of portal-routes.test.ts: drizzle's chained
// query builders are awaitable thenables; we model the minimal surface the
// route + the Phase-1 getOrCreateReferralCode actually use.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Email channel is unrelated — no-op it so nothing touches the network.
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));

// No outbound Stripe in these read-only route tests, but the route module's
// import graph pulls stripe-client in (via customer-portal). Mock the surface.
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: vi.fn(),
  stripeConfigured: () => true,
  universityStripeKey: () => "rk_test_university",
}));

import { universityReferralRoutes } from "../routes/university-referrals.js";
import { errorHandler } from "../middleware/index.js";
import {
  PORTAL_SESSION_COOKIE,
  issueSession,
} from "../services/customer-portal.js";
import {
  customerAccounts,
  universityMembers,
  universityReferralCodes,
  universityReferrals,
  universityCreditLedger,
} from "@paperclipai/db";

// ---------------------------------------------------------------------------
// In-memory state + db stub
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}
interface MemberRow {
  id: string;
  email: string;
  accountId: string | null;
  status: string;
  plan: string | null;
  joinedAt: Date | null;
  createdAt: Date;
}
interface CodeRow {
  id: string;
  email: string;
  accountId: string | null;
  code: string;
  status: string;
}
interface ReferralRow {
  id: string;
  referrerEmail: string;
  referredEmail: string;
  status: string;
  attributedAt: Date;
  activatedAt: Date | null;
}
interface LedgerRow {
  id: string;
  email: string;
  amountCents: number;
  kind: string;
  source: string;
}

interface State {
  accounts: AccountRow[];
  members: MemberRow[];
  codes: CodeRow[];
  referrals: ReferralRow[];
  ledger: LedgerRow[];
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `id-${idSeq}`;
}

function makeDb(state: State) {
  function tableKey(t: unknown): string {
    if (t === customerAccounts) return "accounts";
    if (t === universityMembers) return "members";
    if (t === universityReferralCodes) return "codes";
    if (t === universityReferrals) return "referrals";
    if (t === universityCreditLedger) return "ledger";
    return "unknown";
  }

  // The route + getOrCreateReferralCode issue several distinctly-shaped queries
  // against each table. Rather than parse drizzle's SQL AST, we capture the
  // table and let the test's state closures answer. Each query the code makes:
  //   - accounts: select * where id = ? (getAccount) → return the only account
  //   - members:  select status... where email=? (isUniversityAccount/active) →
  //               return all members (route filters by .limit(1) semantics; our
  //               stub returns the matching email rows)
  //   - codes:    select code where LOWER(email)=? ; insert ... returning
  //   - referrals: select referrer's referrals where referrerEmail=?
  //   - ledger:   select SUM(amount_cents) where LOWER(email)=?
  // The stub keys on table; WHERE-narrowing is handled by the resolver below.

  function rowsFor(table: string): unknown[] {
    switch (table) {
      case "accounts":
        return state.accounts;
      case "members":
        return state.members;
      case "codes":
        return state.codes;
      case "referrals":
        return state.referrals;
      case "ledger":
        // The route reads SUM(amount_cents); the stub returns the aggregate as
        // a single { total } row to mirror the COALESCE(SUM(...)) projection.
        return [
          {
            total: String(
              state.ledger.reduce((acc, r) => acc + r.amountCents, 0),
            ),
          },
        ];
      default:
        return [];
    }
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
          then: (
            resolve: (v: unknown[]) => void,
            reject?: (e: unknown) => void,
          ) => {
            try {
              return resolve(rowsFor(table));
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
    let pending: Record<string, unknown> | null = null;
    const api: any = {
      values(payload: Record<string, unknown>) {
        pending = payload;
        if (name === "codes") {
          // Mirror UNIQUE(email): if a code already exists for this email, the
          // insert no-ops (onConflictDoNothing) — Phase-1 then re-reads.
          const email = String(payload.email).toLowerCase();
          if (!state.codes.some((c) => c.email.toLowerCase() === email)) {
            state.codes.push({
              id: nextId(),
              email,
              accountId: (payload.accountId as string | null) ?? null,
              code: String(payload.code),
              status: String(payload.status ?? "active"),
            });
          } else {
            pending = null; // conflict → nothing inserted
          }
        }
        return api;
      },
      onConflictDoNothing() {
        return api;
      },
      returning() {
        // getOrCreateReferralCode reads { code } off the returned row; return
        // the just-inserted row, or [] on conflict.
        if (name === "codes" && pending) {
          return Promise.resolve([{ code: String(pending.code) }]);
        }
        return Promise.resolve([]);
      },
      then(resolve: (v: unknown) => void) {
        resolve(undefined);
      },
    };
    return api;
  }

  function updateImpl() {
    const api: any = {
      set: () => api,
      where: () => Promise.resolve(undefined),
    };
    return api;
  }

  return {
    select: selectImpl,
    insert: insertImpl,
    update: updateImpl,
  } as any;
}

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

function makeApp(state: State) {
  const app = express();
  app.use(express.json());
  app.use("/api/portal", universityReferralRoutes(makeDb(state)));
  app.use(errorHandler);
  return app;
}

function sessionCookie(accountId: string): string {
  const value = issueSession(accountId);
  return `${PORTAL_SESSION_COOKIE}=${encodeURIComponent(value)}`;
}

function freshState(): State {
  idSeq = 0;
  return { accounts: [], members: [], codes: [], referrals: [], ledger: [] };
}

const ACCOUNT_ID = "00000000-0000-0000-0000-0000000000aa";
const MEMBER_EMAIL = "member@test.dev";

function seedActiveMember(state: State) {
  state.accounts.push({
    id: ACCOUNT_ID,
    email: MEMBER_EMAIL,
    stripeCustomerId: null,
    createdAt: new Date(),
    lastLoginAt: null,
  });
  state.members.push({
    id: nextId(),
    email: MEMBER_EMAIL,
    accountId: ACCOUNT_ID,
    status: "active",
    plan: "university_monthly",
    joinedAt: new Date(),
    createdAt: new Date(),
  });
}

describe("GET /api/portal/university/referral", () => {
  let state: State;
  beforeEach(() => {
    state = freshState();
    // Session signing needs a secret; PORTAL_BASE_URL is read by portalBaseUrl.
    process.env.PORTAL_SESSION_SECRET =
      "test-test-test-test-test-test-test-test-test-test-secret";
    process.env.PORTAL_BASE_URL = "https://app.test.local";
    process.env.NODE_ENV = "development";
  });

  it("401 without a session", async () => {
    const app = makeApp(state);
    const res = await request(app).get("/api/portal/university/referral");
    expect(res.status).toBe(401);
  });

  it("403 for a logged-in non-member", async () => {
    // Account exists, but NO university_members row → not a member.
    state.accounts.push({
      id: ACCOUNT_ID,
      email: MEMBER_EMAIL,
      stripeCustomerId: null,
      createdAt: new Date(),
      lastLoginAt: null,
    });
    const app = makeApp(state);
    const res = await request(app)
      .get("/api/portal/university/referral")
      .set("Cookie", sessionCookie(ACCOUNT_ID));
    expect(res.status).toBe(403);
  });

  it("lazily creates a code and returns the shareable url + zero balance", async () => {
    seedActiveMember(state);
    const app = makeApp(state);
    const res = await request(app)
      .get("/api/portal/university/referral")
      .set("Cookie", sessionCookie(ACCOUNT_ID));

    expect(res.status).toBe(200);
    expect(typeof res.body.code).toBe("string");
    expect(res.body.code.length).toBeGreaterThan(0);
    expect(res.body.url).toBe(
      `https://coherencedaddy.com/university?ref=${res.body.code}`,
    );
    expect(res.body.creditBalanceCents).toBe(0);
    expect(Array.isArray(res.body.referrals)).toBe(true);
    expect(res.body.referrals).toHaveLength(0);
    // The code was persisted (lazy create).
    expect(state.codes).toHaveLength(1);
    expect(state.codes[0]!.email).toBe(MEMBER_EMAIL);
  });

  it("returns the existing code on a repeat call (idempotent)", async () => {
    seedActiveMember(state);
    state.codes.push({
      id: nextId(),
      email: MEMBER_EMAIL,
      accountId: ACCOUNT_ID,
      code: "EXISTING1",
      status: "active",
    });
    const app = makeApp(state);
    const res = await request(app)
      .get("/api/portal/university/referral")
      .set("Cookie", sessionCookie(ACCOUNT_ID));
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("EXISTING1");
    expect(state.codes).toHaveLength(1); // not re-created
  });

  it("sums the ledger for the credit balance", async () => {
    seedActiveMember(state);
    state.codes.push({
      id: nextId(),
      email: MEMBER_EMAIL,
      accountId: ACCOUNT_ID,
      code: "EXISTING1",
      status: "active",
    });
    // +$10 +$10 earned, -$5 applied → $15.00 = 1500 cents.
    state.ledger.push(
      { id: nextId(), email: MEMBER_EMAIL, amountCents: 1000, kind: "referral_earned", source: "referral" },
      { id: nextId(), email: MEMBER_EMAIL, amountCents: 1000, kind: "referral_earned", source: "referral" },
      { id: nextId(), email: MEMBER_EMAIL, amountCents: -500, kind: "credit_applied", source: "referral" },
    );
    const app = makeApp(state);
    const res = await request(app)
      .get("/api/portal/university/referral")
      .set("Cookie", sessionCookie(ACCOUNT_ID));
    expect(res.status).toBe(200);
    expect(res.body.creditBalanceCents).toBe(1500);
  });

  it("returns referrals with masked email, status, and monthly earnings", async () => {
    seedActiveMember(state);
    state.codes.push({
      id: nextId(),
      email: MEMBER_EMAIL,
      accountId: ACCOUNT_ID,
      code: "EXISTING1",
      status: "active",
    });
    state.referrals.push(
      {
        id: nextId(),
        referrerEmail: MEMBER_EMAIL,
        referredEmail: "friend@gmail.com",
        status: "active",
        attributedAt: new Date("2026-01-01T00:00:00Z"),
        activatedAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        id: nextId(),
        referrerEmail: MEMBER_EMAIL,
        referredEmail: "pending@yahoo.com",
        status: "pending",
        attributedAt: new Date("2026-02-01T00:00:00Z"),
        activatedAt: null,
      },
    );
    const app = makeApp(state);
    const res = await request(app)
      .get("/api/portal/university/referral")
      .set("Cookie", sessionCookie(ACCOUNT_ID));

    expect(res.status).toBe(200);
    expect(res.body.referrals).toHaveLength(2);

    const active = res.body.referrals.find(
      (r: any) => r.status === "active",
    );
    expect(active).toBeTruthy();
    // Email is masked — the raw address never leaves the server.
    expect(active.email).not.toContain("friend@gmail.com");
    expect(active.email).toContain("@");
    expect(active.email).toContain("•");
    // An active referral earns the per-month reward; pending earns nothing.
    expect(active.monthlyCreditCents).toBe(1000);

    const pending = res.body.referrals.find(
      (r: any) => r.status === "pending",
    );
    expect(pending.monthlyCreditCents).toBe(0);
  });
});
