// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner commentTick (threaded-reply poller).
//
// Integration test against a REAL embedded Postgres with the full migration
// chain applied. Proves the Tier 3 threading behavior:
//   - a real member's comment on an agent's post triggers EXACTLY ONE agent reply
//   - a comment authored by an agent+ address triggers NONE (no agent-to-agent loops)
//   - comment-replies COUNT toward the existing per-post cap of <=2 agent replies
//
// Claude is mocked (no network): callClaude returns a fixed, safety-gate-passing
// line so the reply path is deterministic. Skips cleanly (NO fake pass) if the
// embedded Postgres harness is unavailable (matches university-community.test.ts).
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";

// Mock the Anthropic call so no network is hit and the reply is deterministic.
// The returned text must pass safety.contentSafe (no AI ref, no advice/jargon,
// <=2 sentences, no emoji).
vi.mock("./claude.js", () => ({
  callClaude: vi.fn(async () => ({
    text: "welcome in, you are doing better than you think.",
    model: "claude-haiku-4-5",
    inputTokens: 10,
    outputTokens: 8,
  })),
}));

import {
  createDb,
  customerAccounts,
  universityMembers,
  universityAgentConfig,
  universityCommunityPosts,
  universityCommunityComments,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "../../__tests__/helpers/embedded-postgres-no-pgvector.js";
import { AgentEngine, type CommunityWriter } from "./engine.js";
import { agentEmail } from "./personas.js";
import { __resetCommentWatermarkForTest } from "./comment-watermark.js";

const AGENT_KEY = "wendell"; // moderator persona; also the agent post's author
const AGENT_EMAIL = agentEmail(AGENT_KEY); // agent+wendell@coherencedaddy.com

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
    `Skipping agent commentTick test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("agent runner commentTick (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let engine!: AgentEngine;
  let agentAccountId!: string;

  // Minimal in-process community writer: inserts a comment authored by the
  // account's own member email (mirrors the real service's identity behavior),
  // which is what lets us assert exactly-one agent reply from the DB.
  const community: CommunityWriter = {
    async createCommunityPost() {
      throw new Error("createCommunityPost not used in this test");
    },
    async createCommunityComment(accountId, postId, body) {
      const [m] = await db
        .select({ email: universityMembers.email })
        .from(universityMembers)
        .where(eq(universityMembers.accountId, accountId))
        .limit(1);
      const [row] = await db
        .insert(universityCommunityComments)
        .values({
          postId,
          accountId,
          authorEmail: (m?.email ?? "unknown@test").toLowerCase(),
          body,
        })
        .returning({ id: universityCommunityComments.id });
      return { id: row!.id };
    },
  };

  beforeAll(async () => {
    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase("agent-comment-tick-");
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase("agent-comment-tick-novec-");
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // The agent member (Wendell), enabled + configured always-in-hours.
    const [agentAcct] = await db
      .insert(customerAccounts)
      .values({ email: AGENT_EMAIL })
      .returning();
    agentAccountId = agentAcct!.id;
    const [agentMember] = await db
      .insert(universityMembers)
      .values({
        accountId: agentAccountId,
        email: AGENT_EMAIL,
        displayName: "Wendell Brooks",
        status: "active",
        joinedAt: new Date(),
        isAgent: true,
        agentPersonaKey: AGENT_KEY,
      })
      .returning();
    // Make the agent always in-hours: the config CHECK caps end_hour at 23, so a
    // literal 0..24 window is impossible. Anchor a wrapping window to the current
    // New York hour (Wendell's tz) — [H, H-1) covers all 24 hours except H-1, so
    // the current hour is always inside it (see engine.withinHours).
    const nyHour =
      Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          hour12: false,
        }).format(new Date()),
      ) % 24;
    await db.insert(universityAgentConfig).values({
      memberId: agentMember!.id,
      personaKey: AGENT_KEY,
      model: "claude-haiku-4-5",
      postProbability: "0.2",
      commentProbability: "0.2",
      activeStartHour: nyHour,
      activeEndHour: (nyHour + 23) % 24,
    });

    engine = new AgentEngine({
      db,
      community,
      apiKey: "test-key",
      dailyBudgetUsd: 100, // generous — LLM path stays allowed
    });
  }, 60_000);

  beforeEach(async () => {
    // Start every test from a clean cursor so freshly-inserted comments are
    // always candidates, and from clean in-memory caps (fresh engine state is
    // rebuilt per test via a new engine below only where needed). The cursor is
    // now durable (Tier 2 university_agent_watermark), so the reset deletes the
    // sentinel row.
    await __resetCommentWatermarkForTest(db);
  });

  afterEach(async () => {
    await db.delete(universityCommunityComments);
    await db.delete(universityCommunityPosts);
    // Rebuild engine so the in-memory responsive caps (per-post responders,
    // per-member counters, hourly counter) don't leak across tests. Release the
    // current engine's single-runner advisory lock FIRST — it lives on a reserved
    // connection held for the engine's lifetime, so a fresh engine could not
    // re-acquire it (its ticks would silently no-op) until it is handed back.
    await engine.releaseAdvisoryLock();
    engine = new AgentEngine({
      db,
      community,
      apiKey: "test-key",
      dailyBudgetUsd: 100,
    });
  });

  afterAll(async () => {
    await engine?.releaseAdvisoryLock();
    await cleanup?.();
  });

  // Helpers ------------------------------------------------------------------

  async function seedRealMember(email: string): Promise<string> {
    const [acct] = await db
      .insert(customerAccounts)
      .values({ email })
      .returning();
    await db
      .insert(universityMembers)
      .values({
        accountId: acct!.id,
        email,
        status: "active",
        joinedAt: new Date(),
      })
      .onConflictDoNothing();
    return acct!.id;
  }

  async function seedAgentPost(): Promise<string> {
    const [post] = await db
      .insert(universityCommunityPosts)
      .values({
        accountId: agentAccountId,
        authorEmail: AGENT_EMAIL,
        body: "New folks: you don't have to do it perfectly. You just have to do it.",
      })
      .returning({ id: universityCommunityPosts.id });
    return post!.id;
  }

  async function insertComment(
    postId: string,
    accountId: string | null,
    authorEmail: string,
    body: string,
  ): Promise<void> {
    await db.insert(universityCommunityComments).values({
      postId,
      accountId,
      authorEmail: authorEmail.toLowerCase(),
      body,
    });
  }

  async function agentReplyCount(postId: string): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(universityCommunityComments)
      .where(
        and(
          eq(universityCommunityComments.postId, postId),
          like(universityCommunityComments.authorEmail, "agent+%"),
        ),
      );
    return Number(rows[0]?.c ?? 0);
  }

  // Tests --------------------------------------------------------------------

  it("a real member's comment on an agent's post triggers exactly one agent reply", async () => {
    const postId = await seedAgentPost();
    const memberAcct = await seedRealMember("member-a@test.local");
    await insertComment(
      postId,
      memberAcct,
      "member-a@test.local",
      "brand new here and a little lost, where do i even start?",
    );

    await engine.commentTick();

    // Exactly one agent+ reply, and it's the post author (Wendell) carrying the
    // thread (prefer-agent-in-thread guard).
    expect(await agentReplyCount(postId)).toBe(1);
    const [reply] = await db
      .select({ authorEmail: universityCommunityComments.authorEmail })
      .from(universityCommunityComments)
      .where(
        and(
          eq(universityCommunityComments.postId, postId),
          like(universityCommunityComments.authorEmail, "agent+%"),
        ),
      );
    expect(reply!.authorEmail).toBe(AGENT_EMAIL);
  });

  it("a comment authored by an agent+ address triggers NO reply (no agent-to-agent loops)", async () => {
    const postId = await seedAgentPost();
    // An agent-authored comment on the post (e.g. an ambient agent comment).
    await insertComment(
      postId,
      agentAccountId,
      AGENT_EMAIL,
      "checking in on the quiet ones. we see you.",
    );

    const before = await agentReplyCount(postId);
    await engine.commentTick();
    const after = await agentReplyCount(postId);

    // No NEW agent reply was generated for the agent-authored comment.
    expect(after).toBe(before);
    expect(after).toBe(1); // only the one we inserted; no reply added
  });

  it("comment-replies respect the <=2 agents/post cap", async () => {
    const postId = await seedAgentPost();
    // Three DISTINCT real members each comment on the same post (distinct so the
    // per-member cooldown/daily caps don't mask the per-post cap).
    const a = await seedRealMember("member-b1@test.local");
    const b = await seedRealMember("member-b2@test.local");
    const c = await seedRealMember("member-b3@test.local");
    await insertComment(postId, a, "member-b1@test.local", "how do you stay consistent?");
    await insertComment(postId, b, "member-b2@test.local", "any tips for the first week?");
    await insertComment(postId, c, "member-b3@test.local", "is it normal to feel restless?");

    await engine.commentTick();

    // At most two agent replies on the post, even though three members commented.
    expect(await agentReplyCount(postId)).toBe(2);
  });
});
