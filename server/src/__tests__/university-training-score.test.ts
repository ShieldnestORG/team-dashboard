// ---------------------------------------------------------------------------
// Coherent Ones University — TRAINING drill score endpoint + community badge
// test (no live Stripe, no network).
//
// Integration tests against a REAL embedded Postgres with the full migration
// chain applied (incl. 0153_university_training_scores), through the REAL
// mounted Express portal route, authenticated with a real issueSession()
// cookie. Mirrors university-community.test.ts. Proves:
//   - 401 without a session; 403 for a logged-in NON-member (membership gate)
//   - writes blocked under impersonation (read-only, requireNonImpersonating)
//   - 400 on an unknown drill slug and out-of-range/non-integer level/score,
//     writing nothing
//   - upsert semantics per (member, game): best_score = GREATEST(existing,
//     incoming); best_level follows the best-scoring run and is replaced ONLY
//     when the incoming score STRICTLY beats the stored best (a tie keeps the
//     old level); plays increments on EVERY valid submission
//   - the community feed decorates authors with trainingBadge: tier from the
//     member's aggregate (MAX best_score), pct = percent_rank 1-99 over
//     NON-AGENT scored members, plays = SUM(plays); unscored members carry NO
//     badge; agent-persona members NEVER carry one and are EXCLUDED from the
//     percentile pool (honesty mandate)
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-community.test.ts. The skip prints its reason.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The portal service imports the magic-link email callback at module load.
// No-op it so nothing touches the network (mirrors university-community.test.ts).
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
  universityCommunityPosts,
  universityTrainingScores,
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
import { eq } from "drizzle-orm";
import { useLocalServer } from "./helpers/supertest-server.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars
// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
const TRUSTED_ORIGIN = "https://app.test.local";
const MEMBER_EMAIL = "member@training.test";
const MEMBER2_EMAIL = "member2@training.test";
const NONMEMBER_EMAIL = "nonmember@training.test";
const AGENT_EMAIL = "agent+zed@training.test";

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
    `Skipping university training-score integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university training-score integration test: pgvector unavailable — running ` +
      `against real Postgres with the vector(N)→text migration shim. Reason: ${
        support.reason ?? "unknown"
      }`,
  );
}

describeDb("university training-score endpoint + badge (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  const local = useLocalServer();
  let memberAccountId!: string;
  let member2AccountId!: string;
  let nonMemberAccountId!: string;
  let memberId!: string;
  let member2Id!: string;
  let agentMemberId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";
    // Lift the per-member write ceiling for the functional suite — the
    // limiter's behaviour is covered by the community 429 test.
    process.env.UNIVERSITY_TRAINING_SCORE_RATE_PER_MIN = "1000";
    process.env.COMMUNITY_POST_RATE_PER_MIN = "1000";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-training-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-training-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // Seed three customer_accounts: two University members, one non-member.
    const [member] = await db
      .insert(customerAccounts)
      .values({ email: MEMBER_EMAIL })
      .returning();
    memberAccountId = member.id;
    const [member2] = await db
      .insert(customerAccounts)
      .values({ email: MEMBER2_EMAIL })
      .returning();
    member2AccountId = member2.id;
    const [nonMember] = await db
      .insert(customerAccounts)
      .values({ email: NONMEMBER_EMAIL })
      .returning();
    nonMemberAccountId = nonMember.id;

    // Two real member rows + one AGENT-persona member row (no login account —
    // agents post via the runner; their scores must never surface).
    const [m1] = await db
      .insert(universityMembers)
      .values({
        accountId: memberAccountId,
        email: MEMBER_EMAIL,
        displayName: "Scorer One",
        status: "active",
        joinedAt: new Date(),
      })
      .returning();
    memberId = m1.id;
    const [m2] = await db
      .insert(universityMembers)
      .values({
        accountId: member2AccountId,
        email: MEMBER2_EMAIL,
        status: "active",
        joinedAt: new Date(),
      })
      .returning();
    member2Id = m2.id;
    const [agent] = await db
      .insert(universityMembers)
      .values({
        email: AGENT_EMAIL,
        displayName: "Zed",
        status: "active",
        isAgent: true,
        joinedAt: new Date(),
      })
      .returning();
    agentMemberId = agent.id;

    app = express();
    app.use(express.json());
    app.use("/api/portal", portalRoutes(db));
    app.use(errorHandler);
  }, 60_000);

  afterEach(async () => {
    await db.delete(universityCommunityPosts);
    await db.delete(universityTrainingScores);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  function memberCookie(): string {
    return `${PORTAL_SESSION_COOKIE}=${issueSession(memberAccountId)}`;
  }
  function member2Cookie(): string {
    return `${PORTAL_SESSION_COOKIE}=${issueSession(member2AccountId)}`;
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

  async function submitScore(
    cookie: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await request(local.via(app))
      .post("/api/portal/university/training/score")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", cookie)
      .send(payload);
    return { status: res.status, body: res.body };
  }

  async function scoreRow(gameSlug: string) {
    const rows = await db
      .select()
      .from(universityTrainingScores)
      .where(eq(universityTrainingScores.gameSlug, gameSlug));
    return rows;
  }

  it("401 without a session cookie", async () => {
    const res = await request(local.via(app))
      .post("/api/portal/university/training/score")
      .set("Origin", TRUSTED_ORIGIN)
      .send({ game: "reaction-tap", level: 1, score: 100 });
    expect(res.status).toBe(401);
  });

  it("403 for a logged-in NON-member (membership gate), nothing written", async () => {
    const res = await submitScore(nonMemberCookie(), {
      game: "reaction-tap",
      level: 1,
      score: 100,
    });
    expect(res.status).toBe(403);
    expect(await db.select().from(universityTrainingScores)).toHaveLength(0);
  });

  it("blocks writes under impersonation (read-only), nothing written", async () => {
    const res = await submitScore(impersonationCookie(), {
      game: "reaction-tap",
      level: 1,
      score: 100,
    });
    expect(res.status).toBe(403);
    expect(res.body.impersonating).toBe(true);
    expect(await db.select().from(universityTrainingScores)).toHaveLength(0);
  });

  it("400 on unknown drill slug / bad level / bad score, nothing written", async () => {
    const cases: Array<Record<string, unknown>> = [
      { game: "tetris", level: 1, score: 100 }, // not in the allowlist
      { game: "reaction-tap", level: 0, score: 100 }, // level < 1
      { game: "reaction-tap", level: 6, score: 100 }, // level > 5
      { game: "reaction-tap", level: 1.5, score: 100 }, // non-integer level
      { game: "reaction-tap", level: 1, score: -1 }, // score < 0
      { game: "reaction-tap", level: 1, score: 1001 }, // score > 1000
      { game: "reaction-tap", level: 1, score: 99.9 }, // non-integer score
      { level: 1, score: 100 }, // game missing
    ];
    for (const payload of cases) {
      const res = await submitScore(memberCookie(), payload);
      expect(res.status).toBe(400);
    }
    expect(await db.select().from(universityTrainingScores)).toHaveLength(0);
  });

  it("upserts per (member, game): GREATEST score, best-run level, plays on every submission", async () => {
    // First run: row created as submitted, plays 1.
    let res = await submitScore(memberCookie(), {
      game: "reaction-tap",
      level: 2,
      score: 500,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true }); // scores never echoed back
    let [row] = await scoreRow("reaction-tap");
    expect(row.memberId).toBe(memberId);
    expect(row.bestScore).toBe(500);
    expect(row.bestLevel).toBe(2);
    expect(row.plays).toBe(1);

    // Worse run: best untouched, plays still increments.
    res = await submitScore(memberCookie(), {
      game: "reaction-tap",
      level: 3,
      score: 300,
    });
    expect(res.status).toBe(200);
    [row] = await scoreRow("reaction-tap");
    expect(row.bestScore).toBe(500);
    expect(row.bestLevel).toBe(2);
    expect(row.plays).toBe(2);

    // Better run: best score AND best level follow the new run.
    res = await submitScore(memberCookie(), {
      game: "reaction-tap",
      level: 4,
      score: 800,
    });
    expect(res.status).toBe(200);
    [row] = await scoreRow("reaction-tap");
    expect(row.bestScore).toBe(800);
    expect(row.bestLevel).toBe(4);
    expect(row.plays).toBe(3);

    // Tie: only a STRICTLY better score replaces the level.
    res = await submitScore(memberCookie(), {
      game: "reaction-tap",
      level: 1,
      score: 800,
    });
    expect(res.status).toBe(200);
    [row] = await scoreRow("reaction-tap");
    expect(row.bestScore).toBe(800);
    expect(row.bestLevel).toBe(4);
    expect(row.plays).toBe(4);

    // A different drill gets its own row.
    res = await submitScore(memberCookie(), {
      game: "circuit",
      level: 1,
      score: 250,
    });
    expect(res.status).toBe(200);
    expect(await db.select().from(universityTrainingScores)).toHaveLength(2);
  });

  it("feed authors carry trainingBadge per contract; unscored + agents stay bare", async () => {
    // member1: two drills, aggregate 900 (coral), plays 3.
    await submitScore(memberCookie(), { game: "reaction-tap", level: 5, score: 900 });
    await submitScore(memberCookie(), { game: "circuit", level: 1, score: 400 });
    await submitScore(memberCookie(), { game: "circuit", level: 1, score: 300 });
    // member2: one drill, aggregate 400 (bronze), plays 1.
    await submitScore(member2Cookie(), { game: "sequence-memory", level: 1, score: 400 });
    // Agent persona: a score row written directly (the route can't be reached
    // by an agent — no login). Tops the board on raw numbers; must NOT surface
    // anywhere nor skew the percentile pool.
    await db.insert(universityTrainingScores).values({
      memberId: agentMemberId,
      gameSlug: "pattern-grid",
      bestScore: 1000,
      bestLevel: 5,
      plays: 50,
    });

    // Three posts: member1, member2, and the agent (inserted directly, the
    // way the agent runner writes posts).
    await request(local.via(app))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ body: "post by scorer one" });
    await request(local.via(app))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ body: "post by unscored member" });
    await db.insert(universityCommunityPosts).values({
      authorEmail: AGENT_EMAIL,
      body: "post by agent",
    });

    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", memberCookie());
    expect(feed.status).toBe(200);
    expect(feed.body.posts).toHaveLength(3);

    type FeedPost = { body: string; author: Record<string, unknown> };
    const byBody = new Map<string, FeedPost>(
      (feed.body.posts as FeedPost[]).map((p) => [p.body, p]),
    );

    // member1: aggregate 900 → coral; top of a 2-member non-agent pool →
    // percent_rank 1 → pct clamps to 99; plays = 1 + 2 = 3.
    const p1 = byBody.get("post by scorer one")!;
    expect(p1.author.trainingBadge).toEqual({
      tier: "coral",
      pct: 99,
      plays: 3,
    });

    // member2: aggregate 400 → bronze; bottom of the pool → percent_rank 0 →
    // pct clamps to 1; plays = 1.
    const p2 = byBody.get("post by unscored member")!;
    expect(p2.author.trainingBadge).toEqual({
      tier: "bronze",
      pct: 1,
      plays: 1,
    });

    // Agent: no badge, ever — despite holding the highest raw score. And the
    // members' pcts above prove the agent was excluded from the pool (with the
    // agent included, member1 would rank mid-pool, not 99).
    const pAgent = byBody.get("post by agent")!;
    expect(pAgent.author.trainingBadge).toBeUndefined();
  });

  it("members with no scores carry NO badge (absent, never zeroed)", async () => {
    await request(local.via(app))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ body: "unscored post" });

    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", memberCookie());
    expect(feed.status).toBe(200);
    expect(feed.body.posts).toHaveLength(1);
    expect(feed.body.posts[0].author.trainingBadge).toBeUndefined();
    expect("trainingBadge" in feed.body.posts[0].author).toBe(false);
  });
});
