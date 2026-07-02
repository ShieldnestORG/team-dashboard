// ---------------------------------------------------------------------------
// Coherent Ones University — rep-log / progress backend test (no live Stripe,
// no network). The "Practice" half of the learning loop.
//
// Two layers:
//   1. Pure streak-math unit tests — computeStreak() is deterministic (Rule 5),
//      so we assert it directly without any DB. These ALWAYS run.
//   2. Integration tests against a REAL embedded Postgres with the full
//      migration chain applied (incl. 0123_university_progress), through the
//      REAL mounted Express portal route, authenticated with a real
//      issueSession() cookie. Proves:
//        - 403 for a logged-in NON-member (membership gate)
//        - POST records a rep and returns streak + weekCount
//        - SAME-DAY re-POST is idempotent (no duplicate row; reflection updated)
//        - GET surfaces currentStreak / weekCount / weekGoal / recent
//        - a seeded multi-day rep history yields the correct streak
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-webhook-integration.test.ts. The skip prints its reason.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// The portal service imports the magic-link email callback at module load.
// No-op it so nothing touches the network (mirrors portal-routes.test.ts).
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
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { portalRoutes } from "../routes/portal.js";
import { customerPortalService } from "../services/customer-portal.js";
import { errorHandler } from "../middleware/index.js";
import { issueSession, PORTAL_SESSION_COOKIE } from "../services/customer-portal.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars
// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
// Must match the PORTAL_BASE_URL this suite sets in beforeAll.
const TRUSTED_ORIGIN = "https://app.test.local";
const MEMBER_EMAIL = "member@progress.test";
const NONMEMBER_EMAIL = "nonmember@progress.test";

// --- Layer 1: pure streak math (always runs, no DB) -------------------------
describe("computeStreak (pure, deterministic)", () => {
  // We only need a service instance to reach computeStreak — it ignores `db`.
  const svc = customerPortalService({} as never);
  const today = "2026-06-18";

  it("returns 0 for no reps", () => {
    expect(svc.computeStreak([], today)).toBe(0);
  });

  it("counts a single rep today as a streak of 1", () => {
    expect(svc.computeStreak(["2026-06-18"], today)).toBe(1);
  });

  it("holds the streak when the most recent rep was yesterday (grace day)", () => {
    expect(svc.computeStreak(["2026-06-17"], today)).toBe(1);
    expect(svc.computeStreak(["2026-06-16", "2026-06-17"], today)).toBe(2);
  });

  it("counts a run of consecutive days ending today", () => {
    expect(
      svc.computeStreak(["2026-06-16", "2026-06-17", "2026-06-18"], today),
    ).toBe(3);
  });

  it("breaks the streak at the first missing day", () => {
    // 14th missing → only 16,17,18 count.
    expect(
      svc.computeStreak(
        ["2026-06-13", "2026-06-16", "2026-06-17", "2026-06-18"],
        today,
      ),
    ).toBe(3);
  });

  it("returns 0 when the most recent rep is older than yesterday", () => {
    expect(svc.computeStreak(["2026-06-15", "2026-06-16"], today)).toBe(0);
  });

  it("dedupes duplicate day strings", () => {
    expect(
      svc.computeStreak(["2026-06-18", "2026-06-18", "2026-06-17"], today),
    ).toBe(2);
  });
});

// --- Layer 2: integration against a real Postgres ---------------------------
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
    `Skipping university progress integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university progress integration test: pgvector unavailable — running against ` +
      `real Postgres with the vector(N)→text migration shim. Reason: ${
        support.reason ?? "unknown"
      }`,
  );
}

describeDb("university progress endpoints (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  let memberAccountId!: string;
  let nonMemberAccountId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";
    delete process.env.UNIVERSITY_WEEK_GOAL; // default goal = 5

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-progress-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-progress-novec-",
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

    // The member is a real University member row (active).
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

  it("401 without a session cookie", async () => {
    const res = await request(app).get("/api/portal/university/progress");
    expect(res.status).toBe(401);
  });

  it("403 for a logged-in NON-member (membership gate)", async () => {
    const get = await request(app)
      .get("/api/portal/university/progress")
      .set("Cookie", nonMemberCookie());
    expect(get.status).toBe(403);

    const post = await request(app)
      .post("/api/portal/university/progress")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", nonMemberCookie())
      .send({ lessonSlug: "coherence-101" });
    expect(post.status).toBe(403);

    // Nothing written.
    const rows = await db.select().from(universityProgress);
    expect(rows).toHaveLength(0);
  });

  it("POST records a rep and returns streak=1 + weekCount=1 + weekGoal", async () => {
    const res = await request(app)
      .post("/api/portal/university/progress")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", reflection: "felt clear" });
    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(1);
    expect(res.body.weekCount).toBe(1);
    expect(res.body.weekGoal).toBe(5);

    const rows = await db.select().from(universityProgress);
    expect(rows).toHaveLength(1);
    expect(rows[0].lessonSlug).toBe("coherence-101");
    expect(rows[0].email).toBe(MEMBER_EMAIL);
    expect(rows[0].accountId).toBe(memberAccountId);
    expect(rows[0].drillDone).toBe(true);
    expect(rows[0].reflection).toBe("felt clear");
  });

  it("SAME-DAY re-POST is idempotent: no duplicate row, reflection updated", async () => {
    const first = await request(app)
      .post("/api/portal/university/progress")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", reflection: "first" });
    expect(first.status).toBe(200);
    expect(first.body.weekCount).toBe(1);

    const second = await request(app)
      .post("/api/portal/university/progress")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", reflection: "second", quizScore: 90 });
    expect(second.status).toBe(200);
    // Still a single rep-day for this lesson → streak and week count unchanged.
    expect(second.body.currentStreak).toBe(1);
    expect(second.body.weekCount).toBe(1);

    const rows = await db.select().from(universityProgress);
    expect(rows).toHaveLength(1);
    expect(rows[0].reflection).toBe("second");
    expect(rows[0].quizScore).toBe(90);
  });

  it("a DIFFERENT lesson the same day is a distinct rep but the same rep-day (streak stays 1, weekCount 2)", async () => {
    await request(app)
      .post("/api/portal/university/progress")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101" });
    const res = await request(app)
      .post("/api/portal/university/progress")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-102" });
    expect(res.status).toBe(200);
    // Two lesson reps but ONE distinct rep-day → streak 1. weekCount counts
    // distinct rep-DAYS, so it is also 1 (both reps land on the same day).
    expect(res.body.currentStreak).toBe(1);
    expect(res.body.weekCount).toBe(1);

    const rows = await db.select().from(universityProgress);
    expect(rows).toHaveLength(2);
  });

  it("GET surfaces a multi-day streak computed from distinct rep-days", async () => {
    // Seed three consecutive UTC days ending today, plus a gap-then-old day
    // that must NOT extend the streak. Insert directly (rep_day control).
    const today = new Date().toISOString().slice(0, 10);
    const day = (n: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000)
        .toISOString()
        .slice(0, 10);
    await db.insert(universityProgress).values([
      { accountId: memberAccountId, email: MEMBER_EMAIL, lessonSlug: "a", repDay: day(0) },
      { accountId: memberAccountId, email: MEMBER_EMAIL, lessonSlug: "b", repDay: day(-1) },
      { accountId: memberAccountId, email: MEMBER_EMAIL, lessonSlug: "c", repDay: day(-2) },
      // gap at day(-3); this older one must not count toward the current streak
      { accountId: memberAccountId, email: MEMBER_EMAIL, lessonSlug: "d", repDay: day(-5) },
    ]);

    const res = await request(app)
      .get("/api/portal/university/progress")
      .set("Cookie", memberCookie());
    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(3);
    // Within the trailing 7-day window: day0, -1, -2, -5 → 4 distinct days.
    expect(res.body.weekCount).toBe(4);
    expect(res.body.weekGoal).toBe(5);
    expect(Array.isArray(res.body.recent)).toBe(true);
    expect(res.body.recent.length).toBe(4);
    // recent shape: { lessonSlug, created_at, reflection? }
    expect(res.body.recent[0]).toHaveProperty("lessonSlug");
    expect(res.body.recent[0]).toHaveProperty("created_at");
  });
});
