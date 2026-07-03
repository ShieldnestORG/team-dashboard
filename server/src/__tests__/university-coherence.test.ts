// ---------------------------------------------------------------------------
// Coherent Ones University — coherence self-check backend test (no live Stripe,
// no network). The "how coherent am I right now?" self-rating.
//
// Two layers:
//   1. Pure score-formula unit tests — coherenceScore() is deterministic
//      (Rule 5), so we assert it directly without any DB. These ALWAYS run and
//      pin the FIXED weighting the frontend mirrors byte-for-byte.
//   2. Integration tests against a REAL embedded Postgres, through the REAL
//      mounted Express portal route, authenticated with a real issueSession()
//      cookie. Proves:
//        - 401 without a session cookie
//        - 403 for a logged-in NON-member (membership gate)
//        - GET empty-state summary → nulls + empty arrays
//        - POST logs a check, returns { score } & CoherenceSummary, persists row
//        - 400 on bad input (missing / out-of-range / non-integer axis)
//        - the trailing 7-day average window (older checks excluded)
//
// The orchestrator generates the drizzle migration AFTER this feature lands, so
// the migration chain the embedded-Postgres helpers replay does NOT yet create
// university_coherence_checks. This test creates it via a CREATE TABLE IF NOT
// EXISTS in beforeAll — a no-op once the real migration exists, so it stays
// correct either way. Everything else (customer_accounts, university_members)
// comes from the replayed chain.
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-progress.test.ts. The skip prints its reason.
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
  universityCoherenceChecks,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import { coherenceService, coherenceScore } from "../services/coherence.js";
import { issueSession, PORTAL_SESSION_COOKIE } from "../services/customer-portal.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars
const MEMBER_EMAIL = "member@coherence.test";
const NONMEMBER_EMAIL = "nonmember@coherence.test";

// --- Layer 1: pure score formula (always runs, no DB) -----------------------
describe("coherenceScore (pure, deterministic)", () => {
  it("weights body*0.4 + focus*0.35 + direction*0.25 and rounds", () => {
    // 80*0.4 + 60*0.35 + 40*0.25 = 32 + 21 + 10 = 63 (exact).
    expect(coherenceScore(80, 60, 40)).toBe(63);
    // All-max and all-min clamp to the 0..100 endpoints.
    expect(coherenceScore(100, 100, 100)).toBe(100);
    expect(coherenceScore(0, 0, 0)).toBe(0);
  });

  it("rounds half-values to the nearest integer", () => {
    // 50*0.4 + 51*0.35 + 50*0.25 = 20 + 17.85 + 12.5 = 50.35 → 50.
    expect(coherenceScore(50, 51, 50)).toBe(50);
    // 51*0.4 + 51*0.35 + 51*0.25 = 51 exactly (weights sum to 1).
    expect(coherenceScore(51, 51, 51)).toBe(51);
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
    `Skipping university coherence integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university coherence integration test: pgvector unavailable — running ` +
      `against real Postgres with the vector(N)→text migration shim. Reason: ${
        support.reason ?? "unknown"
      }`,
  );
}

// Matches schema/university.ts universityCoherenceChecks. IF NOT EXISTS so it
// is a no-op once the generated migration lands.
const CREATE_COHERENCE_TABLE = sql`
  CREATE TABLE IF NOT EXISTS university_coherence_checks (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    member_id  UUID        NOT NULL,
    body       INTEGER     NOT NULL,
    focus      INTEGER     NOT NULL,
    direction  INTEGER     NOT NULL,
    score      INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT university_coherence_checks_range_ck CHECK (
      body BETWEEN 0 AND 100
      AND focus BETWEEN 0 AND 100
      AND direction BETWEEN 0 AND 100
      AND score BETWEEN 0 AND 100
    )
  )
`;

describeDb("university coherence endpoints (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  const local = useLocalServer();
  let memberAccountId!: string;
  let nonMemberAccountId!: string;
  let memberId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = "https://app.test.local";
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-coherence-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-coherence-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // Create the coherence table (migration not generated yet — see header).
    await db.execute(CREATE_COHERENCE_TABLE);

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

    // The member is a real University member row (active). Its id is the
    // coherence/voice member identity resolved from the account.
    const [memberRow] = await db
      .insert(universityMembers)
      .values({
        accountId: memberAccountId,
        email: MEMBER_EMAIL,
        status: "active",
        joinedAt: new Date(),
      })
      .returning();
    memberId = memberRow.id;

    app = express();
    app.use(express.json());
    app.use("/api/portal", portalRoutes(db));
    app.use(errorHandler);
  }, 60_000);

  afterEach(async () => {
    await db.delete(universityCoherenceChecks);
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
  // portalCsrfGuard() rejects unsafe methods lacking a trusted Origin/Referer.
  // PORTAL_BASE_URL is the allowed portal origin, so POSTs must send it.
  const TRUSTED_ORIGIN = "https://app.test.local";

  it("401 without a session cookie", async () => {
    const res = await request(local.via(app)).get("/api/portal/university/coherence");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthenticated");
  });

  it("403 for a logged-in NON-member (membership gate)", async () => {
    const get = await request(local.via(app))
      .get("/api/portal/university/coherence")
      .set("Cookie", nonMemberCookie());
    expect(get.status).toBe(403);

    const post = await request(local.via(app))
      .post("/api/portal/university/coherence-check")
      .set("Cookie", nonMemberCookie())
      .set("Origin", TRUSTED_ORIGIN)
      .send({ body: 50, focus: 50, direction: 50 });
    expect(post.status).toBe(403);

    // Nothing written.
    const rows = await db.select().from(universityCoherenceChecks);
    expect(rows).toHaveLength(0);
  });

  it("GET empty-state summary → nulls + empty arrays", async () => {
    const res = await request(local.via(app))
      .get("/api/portal/university/coherence")
      .set("Cookie", memberCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      current: null,
      average7: null,
      history: [],
      recentChecks: [],
    });
  });

  it("POST logs a check and returns { score } & CoherenceSummary", async () => {
    const res = await request(local.via(app))
      .post("/api/portal/university/coherence-check")
      .set("Cookie", memberCookie())
      .set("Origin", TRUSTED_ORIGIN)
      .send({ body: 80, focus: 60, direction: 40 });
    expect(res.status).toBe(200);
    // 80*0.4 + 60*0.35 + 40*0.25 = 63.
    expect(res.body.score).toBe(63);
    expect(res.body.current).toBe(63);
    expect(res.body.average7).toBe(63);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].score).toBe(63);
    expect(typeof res.body.history[0].at).toBe("string");
    expect(res.body.recentChecks).toHaveLength(1);
    expect(res.body.recentChecks[0]).toMatchObject({
      body: 80,
      focus: 60,
      direction: 40,
      score: 63,
    });

    // Persisted with the resolved member id + derived score.
    const rows = await db.select().from(universityCoherenceChecks);
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(memberId);
    expect(rows[0].score).toBe(63);
  });

  it("400 on missing / out-of-range / non-integer axes", async () => {
    const bad = [
      { focus: 50, direction: 50 }, // missing body
      { body: 50, focus: 50, direction: 101 }, // out of range
      { body: 50, focus: 50, direction: -1 }, // out of range
      { body: 50.5, focus: 50, direction: 50 }, // non-integer
      { body: "x", focus: 50, direction: 50 }, // non-numeric
    ];
    for (const payload of bad) {
      const res = await request(local.via(app))
        .post("/api/portal/university/coherence-check")
        .set("Cookie", memberCookie())
        .set("Origin", TRUSTED_ORIGIN)
        .send(payload);
      expect(res.status).toBe(400);
    }
    // Nothing persisted from any rejected request.
    const rows = await db.select().from(universityCoherenceChecks);
    expect(rows).toHaveLength(0);
  });

  it("average7 covers only the trailing 7-day window; history stays chronological", async () => {
    // Seed directly to control created_at. Two recent checks (in-window) and one
    // old check (8 days ago, out-of-window). Scores are given explicitly.
    const now = Date.now();
    const daysAgo = (n: number) => new Date(now - n * 86_400_000);
    await db.insert(universityCoherenceChecks).values([
      // oldest — outside the 7-day window (must NOT count toward average7).
      { memberId, body: 0, focus: 0, direction: 0, score: 0, createdAt: daysAgo(8) },
      // in-window
      { memberId, body: 100, focus: 100, direction: 100, score: 80, createdAt: daysAgo(3) },
      // newest — in-window
      { memberId, body: 100, focus: 100, direction: 100, score: 60, createdAt: daysAgo(1) },
    ]);

    const res = await request(local.via(app))
      .get("/api/portal/university/coherence")
      .set("Cookie", memberCookie());
    expect(res.status).toBe(200);
    // current = most-recent score.
    expect(res.body.current).toBe(60);
    // average7 = mean of in-window scores only: (80 + 60) / 2 = 70. The old 0 is
    // excluded.
    expect(res.body.average7).toBe(70);
    // history is chronological ASC (oldest first) and includes ALL checks.
    expect(res.body.history.map((h: { score: number }) => h.score)).toEqual([
      0, 80, 60,
    ]);
    // recentChecks is newest first.
    expect(res.body.recentChecks.map((c: { score: number }) => c.score)).toEqual(
      [60, 80, 0],
    );
  });

  it("service layer: getCoherenceSummary is empty for an unknown member", async () => {
    const svc = coherenceService(db);
    const summary = await svc.getCoherenceSummary(memberId);
    expect(summary).toEqual({
      current: null,
      average7: null,
      history: [],
      recentChecks: [],
    });
  });
});
