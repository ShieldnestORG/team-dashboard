// ---------------------------------------------------------------------------
// Coherent Ones University — daily CHECK-IN backend test (F2 "Today's Three").
//
// Integration tests against a REAL embedded Postgres with the full migration
// chain applied (incl. 0157_university_checkins), through the REAL mounted
// Express portal route, authenticated with a real issueSession() cookie. Proves:
//   - 401 without a session; 403 for a logged-in NON-member (membership gate)
//   - writes blocked under impersonation (read-only, requireNonImpersonating)
//   - POST records an idempotent day-unique check-in and returns a clean 200
//     already-checked-in state on a same-day re-tap (never a 409)
//   - GET /university/progress surfaces checkedInToday
//   - the streak is a UNION: a check-in counts toward the streak (extends a
//     rep-day run, fills a gap) — while weekCount stays rep-only
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-progress.test.ts. The skip prints its reason.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The portal service imports the magic-link email callback at module load.
// No-op it so nothing touches the network (mirrors university-progress.test.ts).
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: vi.fn(async () => undefined),
}));

// /stripe-portal pulls universityStripeKey at import; none of these tests hit
// it, but the route module imports it, so mock the surface.
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: vi.fn(),
  stripeConfigured: () => false,
  universityStripeKey: () => "rk_test_university",
}));

import {
  createDb,
  customerAccounts,
  universityMembers,
  universityProgress,
  universityCheckins,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import {
  issueSession,
  PORTAL_SESSION_COOKIE,
} from "../services/customer-portal.js";
import {
  issueImpersonationCookie,
  ADMIN_IMPERSONATION_COOKIE,
} from "../services/admin-impersonation.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars
const TRUSTED_ORIGIN = "https://app.test.local";
const MEMBER_EMAIL = "member@checkin.test";
const NONMEMBER_EMAIL = "nonmember@checkin.test";

// --- integration against a real Postgres ------------------------------------
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
    `Skipping university check-in integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("university check-in endpoints (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  const local = useLocalServer();
  let memberAccountId!: string;
  let nonMemberAccountId!: string;

  // UTC-day helpers, relative to the same "today" the backend computes.
  const todayStr = new Date().toISOString().slice(0, 10);
  const day = (n: number) =>
    new Date(Date.parse(`${todayStr}T00:00:00Z`) + n * 86_400_000)
      .toISOString()
      .slice(0, 10);

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";
    delete process.env.UNIVERSITY_WEEK_GOAL; // default goal = 5
    // Lift the per-member write ceiling for the functional suite — the limiter's
    // behaviour is the shared community limiter, covered elsewhere.
    process.env.UNIVERSITY_CHECKIN_RATE_PER_MIN = "1000";
    process.env.COMMUNITY_POST_RATE_PER_MIN = "1000";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase("university-checkin-");
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-checkin-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // Seed two customer_accounts: one University member, one non-member.
    const [member] = await db
      .insert(customerAccounts)
      .values({ email: MEMBER_EMAIL })
      .returning();
    memberAccountId = member.id;
    const [nonMember] = await db
      .insert(customerAccounts)
      .values({ email: NONMEMBER_EMAIL })
      .returning();
    nonMemberAccountId = nonMember.id;

    await db.insert(universityMembers).values({
      accountId: memberAccountId,
      email: MEMBER_EMAIL,
      status: "active",
      joinedAt: new Date(),
    });

    app = express();
    app.use(express.json());
    app.use("/api/portal", portalRoutes(db));
    app.use(errorHandler);
  }, 60_000);

  afterEach(async () => {
    await db.delete(universityCheckins);
    await db.delete(universityProgress);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  function memberCookie(): string {
    return `${PORTAL_SESSION_COOKIE}=${issueSession(memberAccountId)}`;
  }
  function nonMemberCookie(): string {
    return `${PORTAL_SESSION_COOKIE}=${issueSession(nonMemberAccountId)}`;
  }
  function impersonationCookie(): string {
    const { value } = issueImpersonationCookie({
      adminActorId: "admin-actor-1",
      targetAccountId: memberAccountId,
    });
    return `${ADMIN_IMPERSONATION_COOKIE}=${encodeURIComponent(value)}`;
  }

  function postCheckin(cookie?: string) {
    const req = request(local.via(app))
      .post("/api/portal/university/checkin")
      .set("Origin", TRUSTED_ORIGIN);
    return cookie ? req.set("Cookie", cookie) : req;
  }
  function getProgress(cookie: string) {
    return request(local.via(app))
      .get("/api/portal/university/progress")
      .set("Cookie", cookie);
  }

  it("401 without a session cookie", async () => {
    const res = await postCheckin();
    expect(res.status).toBe(401);
    const rows = await db.select().from(universityCheckins);
    expect(rows).toHaveLength(0);
  });

  it("403 for a logged-in NON-member (membership gate), nothing written", async () => {
    const res = await postCheckin(nonMemberCookie());
    expect(res.status).toBe(403);
    const rows = await db.select().from(universityCheckins);
    expect(rows).toHaveLength(0);
  });

  it("blocks writes under impersonation (read-only), nothing written", async () => {
    const res = await postCheckin(impersonationCookie());
    expect(res.status).toBe(403);
    expect(res.body.impersonating).toBe(true);
    const rows = await db.select().from(universityCheckins);
    expect(rows).toHaveLength(0);
  });

  it("records a check-in: 200, checkedInToday true, streak 1, exactly one row", async () => {
    const res = await postCheckin(memberCookie());
    expect(res.status).toBe(200);
    expect(res.body.checkedInToday).toBe(true);
    // A stand-alone check-in with no rep is a union streak of 1.
    expect(res.body.currentStreak).toBe(1);
    // Only the streak unions — the check-in must NOT inflate rep-only metrics.
    expect(res.body.weekCount).toBe(0);
    expect(res.body.totalReps).toBe(0);

    const rows = await db.select().from(universityCheckins);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(MEMBER_EMAIL);
    expect(rows[0].accountId).toBe(memberAccountId);
    expect(String(rows[0].checkinDay)).toBe(todayStr);
  });

  it("same-day re-check-in is idempotent: still 200, checkedInToday true, exactly one row (never 409)", async () => {
    const first = await postCheckin(memberCookie());
    expect(first.status).toBe(200);
    expect(first.body.checkedInToday).toBe(true);

    const second = await postCheckin(memberCookie());
    // The already-checked-in path returns a clean 200 (ON CONFLICT DO NOTHING).
    expect(second.status).toBe(200);
    expect(second.body.checkedInToday).toBe(true);
    expect(second.body.currentStreak).toBe(1);

    const rows = await db.select().from(universityCheckins);
    expect(rows).toHaveLength(1);
  });

  it("GET /university/progress surfaces checkedInToday (false before, true after)", async () => {
    const before = await getProgress(memberCookie());
    expect(before.status).toBe(200);
    expect(before.body.checkedInToday).toBe(false);

    await postCheckin(memberCookie());

    const after = await getProgress(memberCookie());
    expect(after.status).toBe(200);
    expect(after.body.checkedInToday).toBe(true);
  });

  it("union streak: a check-in today extends yesterday's rep-day streak", async () => {
    // Rep logged yesterday (streak alive on the grace day), none today.
    await db.insert(universityProgress).values({
      accountId: memberAccountId,
      email: MEMBER_EMAIL,
      lessonSlug: "a",
      repDay: day(-1),
    });

    const before = await getProgress(memberCookie());
    expect(before.body.currentStreak).toBe(1); // rep yesterday, grace day
    expect(before.body.checkedInToday).toBe(false);

    const res = await postCheckin(memberCookie());
    expect(res.status).toBe(200);
    // Union {yesterday rep, today check-in} → consecutive → streak 2.
    expect(res.body.currentStreak).toBe(2);
    expect(res.body.checkedInToday).toBe(true);
    // weekCount is rep-only: still just yesterday's single rep-day.
    expect(res.body.weekCount).toBe(1);
  });

  it("union streak: a check-in fills a gap between rep-days", async () => {
    // Reps today and two-days-ago, with a GAP yesterday → rep-only streak = 1.
    await db.insert(universityProgress).values([
      { accountId: memberAccountId, email: MEMBER_EMAIL, lessonSlug: "a", repDay: day(0) },
      { accountId: memberAccountId, email: MEMBER_EMAIL, lessonSlug: "b", repDay: day(-2) },
    ]);
    // A stand-alone check-in on the gap day (inserted directly — the endpoint
    // only ever checks in *today*; this exercises getProgressSummary's union).
    await db.insert(universityCheckins).values({
      accountId: memberAccountId,
      email: MEMBER_EMAIL,
      checkinDay: day(-1),
    });

    const res = await getProgress(memberCookie());
    expect(res.status).toBe(200);
    // Union {today, -1 check-in, -2} is now a run of 3.
    expect(res.body.currentStreak).toBe(3);
  });
});
