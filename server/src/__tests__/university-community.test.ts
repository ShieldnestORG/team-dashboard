// ---------------------------------------------------------------------------
// Coherent Ones University — native COMMUNITY feed backend test (no live Stripe,
// no network). The "Do, between sessions" beat of the Coherent Loop.
//
// Integration tests against a REAL embedded Postgres with the full migration
// chain applied (incl. 0126_university_community), through the REAL mounted
// Express portal route, authenticated with a real issueSession() cookie. Mirrors
// university-notes.test.ts. Proves:
//   - 401 without a session; 403 for a logged-in NON-member (membership gate)
//   - writes blocked under impersonation (read-only, requireNonImpersonating)
//   - POST creates a post + GET feed returns it (newest first), with author label
//   - profanity gate returns 422 and writes nothing
//   - comment bumps the post comment_count + writes an unread reply notification
//     to the post author (suppressed for self-reply)
//   - reaction is idempotent (double-tap a no-op) and maintains reaction_count;
//     un-react deletes + decrements
//   - report → auto-hide at the threshold removes the post from the feed
//   - feed cursor pagination is stable
//   - unread-count / seen drive the notification badge
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-notes.test.ts. The skip prints its reason.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The portal service imports the magic-link email callback at module load.
// No-op it so nothing touches the network (mirrors university-notes.test.ts).
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
  universityCommunityComments,
  universityCommunityReactions,
  universityCommunityReports,
  universityCommunityNotifications,
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
import { sendCreditscoreEmail } from "../services/creditscore-email-callback.js";
import { eq } from "drizzle-orm";
import { useLocalServer } from "./helpers/supertest-server.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars
// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
// Must match the PORTAL_BASE_URL this suite sets in beforeAll.
const TRUSTED_ORIGIN = "https://app.test.local";
const MEMBER_EMAIL = "member@community.test";
const MEMBER2_EMAIL = "member2@community.test";
const NONMEMBER_EMAIL = "nonmember@community.test";

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
    `Skipping university community integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university community integration test: pgvector unavailable — running ` +
      `against real Postgres with the vector(N)→text migration shim. Reason: ${
        support.reason ?? "unknown"
      }`,
  );
}

describeDb("university community endpoints (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  const local = useLocalServer();
  let memberAccountId!: string;
  let member2AccountId!: string;
  let nonMemberAccountId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";
    process.env.COMMUNITY_AUTOHIDE_REPORTS = "2";
    process.env.COMMUNITY_STAFF_EMAILS = MEMBER_EMAIL; // member1 reads as "Mark"
    // Lift the per-member write rate ceilings for the functional suite — the
    // limiter is exercised by a dedicated 429 test below with a tight ceiling.
    process.env.COMMUNITY_POST_RATE_PER_MIN = "1000";
    process.env.COMMUNITY_COMMENT_RATE_PER_MIN = "1000";
    process.env.COMMUNITY_REACT_RATE_PER_MIN = "1000";
    process.env.COMMUNITY_REPORT_RATE_PER_MIN = "1000";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-community-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-community-novec-",
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

    // Two real, active University member rows. member1 has a display_name;
    // member2 has none (exercises the "Coherent One" fallback).
    await db.insert(universityMembers).values({
      accountId: memberAccountId,
      email: MEMBER_EMAIL,
      displayName: "Mark",
      status: "active",
      joinedAt: new Date(),
    });
    await db.insert(universityMembers).values({
      accountId: member2AccountId,
      email: MEMBER2_EMAIL,
      status: "active",
      joinedAt: new Date(),
    });

    app = express();
    app.use(express.json());
    app.use("/api/portal", portalRoutes(db));
    app.use(errorHandler);
  }, 60_000);

  afterEach(async () => {
    // Children first (FKs), then posts.
    await db.delete(universityCommunityNotifications);
    await db.delete(universityCommunityReactions);
    await db.delete(universityCommunityReports);
    await db.delete(universityCommunityComments);
    await db.delete(universityCommunityPosts);
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
  // An admin impersonating the member — reads resolve as the member, writes
  // are blocked by requireNonImpersonating.
  function impersonationCookie(): string {
    const { value } = issueImpersonationCookie({
      adminActorId: "admin-actor-1",
      targetAccountId: memberAccountId,
    });
    return `${ADMIN_IMPERSONATION_COOKIE}=${encodeURIComponent(value)}`;
  }

  async function createPost(
    cookie: string,
    body: string,
  ): Promise<{ status: number; id?: string; body: Record<string, unknown> }> {
    const res = await request(local.via(app))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", cookie)
      .send({ body });
    return { status: res.status, id: res.body?.post?.id, body: res.body };
  }

  it("401 without a session cookie", async () => {
    const res = await request(local.via(app)).get(
      "/api/portal/university/community/feed",
    );
    expect(res.status).toBe(401);
  });

  it("403 for a logged-in NON-member on feed + post (membership gate)", async () => {
    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", nonMemberCookie());
    expect(feed.status).toBe(403);

    const post = await request(local.via(app))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", nonMemberCookie())
      .send({ body: "hello" });
    expect(post.status).toBe(403);

    const rows = await db.select().from(universityCommunityPosts);
    expect(rows).toHaveLength(0);
  });

  it("blocks writes under impersonation (read-only) but allows reads", async () => {
    // A read resolves as the impersonated member.
    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", impersonationCookie());
    expect(feed.status).toBe(200);

    // A write is blocked with 403 and writes nothing.
    const post = await request(local.via(app))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", impersonationCookie())
      .send({ body: "should be blocked" });
    expect(post.status).toBe(403);
    expect(post.body.impersonating).toBe(true);

    const rows = await db.select().from(universityCommunityPosts);
    expect(rows).toHaveLength(0);
  });

  it("POST creates a post and GET feed returns it with author label", async () => {
    const created = await createPost(memberCookie(), "did my reps today");
    expect(created.status).toBe(201);
    expect(typeof created.id).toBe("string");

    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", memberCookie());
    expect(feed.status).toBe(200);
    expect(feed.body.posts).toHaveLength(1);
    const p = feed.body.posts[0];
    expect(p.body).toBe("did my reps today");
    expect(p.author.displayName).toBe("Mark"); // member1's display_name
    expect(p.author.isYou).toBe(true);
    expect(p.author.isMark).toBe(true); // staff-email list
    expect(typeof p.author.handle).toBe("string");
    expect(p.commentCount).toBe(0);
    expect(p.reactionCount).toBe(0);
    expect(p.youReacted).toBe(false);
  });

  it("falls back to 'Coherent One' for a member with no display_name", async () => {
    await createPost(member2Cookie(), "first post from member2");
    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", member2Cookie());
    expect(feed.status).toBe(200);
    expect(feed.body.posts[0].author.displayName).toBe("Coherent One");
    expect(feed.body.posts[0].author.isMark).toBe(false);
  });

  it("profanity gate returns 422 and writes nothing", async () => {
    const res = await createPost(memberCookie(), "you stupid ass idiot");
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("profanity");
    const rows = await db.select().from(universityCommunityPosts);
    expect(rows).toHaveLength(0);
  });

  it("400 on an empty post body", async () => {
    const res = await createPost(memberCookie(), "   ");
    expect(res.status).toBe(400);
  });

  it("comment bumps comment_count and notifies the post author (not on self-reply)", async () => {
    // member1 posts; member2 comments → member1 gets an unread reply notice.
    const post = await createPost(memberCookie(), "question about lesson 3");
    expect(post.status).toBe(201);

    const comment = await request(local.via(app))
      .post(`/api/portal/university/community/posts/${post.id}/comments`)
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ body: "here is my take" });
    expect(comment.status).toBe(201);
    expect(comment.body.comment.body).toBe("here is my take");
    expect(comment.body.comment.author.isYou).toBe(true);

    // comment_count denormalized on the post.
    const [postRow] = await db
      .select()
      .from(universityCommunityPosts)
      .where(eq(universityCommunityPosts.id, post.id!));
    expect(postRow.commentCount).toBe(1);

    // member1 (the author) has one unread notification.
    const unread = await request(local.via(app))
      .get("/api/portal/university/community/notifications/unread-count")
      .set("Cookie", memberCookie());
    expect(unread.body.count).toBe(1);

    // member2 (the commenter) has none (no self-notify).
    const unread2 = await request(local.via(app))
      .get("/api/portal/university/community/notifications/unread-count")
      .set("Cookie", member2Cookie());
    expect(unread2.body.count).toBe(0);

    // seen clears it.
    const seen = await request(local.via(app))
      .post("/api/portal/university/community/notifications/seen")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie());
    expect(seen.status).toBe(200);
    const unreadAfter = await request(local.via(app))
      .get("/api/portal/university/community/notifications/unread-count")
      .set("Cookie", memberCookie());
    expect(unreadAfter.body.count).toBe(0);
  });

  it("self-reply does NOT create a notification", async () => {
    const post = await createPost(memberCookie(), "talking to myself");
    await request(local.via(app))
      .post(`/api/portal/university/community/posts/${post.id}/comments`)
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ body: "replying to my own post" });
    const notes = await db.select().from(universityCommunityNotifications);
    expect(notes).toHaveLength(0);
  });

  it("does NOT notify or email an AGENT-authored post's author (agent+ recipient)", async () => {
    // A post authored by an agent persona (author_email like 'agent+…') that a
    // real member then comments on. Agents don't consume notifications and have
    // no real inbox, so the reply notification AND the reply email must both be
    // suppressed — while the comment itself still lands (comment_count bumps).
    const AGENT_EMAIL = "agent+atlas@community.test";
    const [agentPost] = await db
      .insert(universityCommunityPosts)
      .values({
        accountId: memberAccountId,
        authorEmail: AGENT_EMAIL,
        body: "seed from an agent persona",
        postType: "statement",
        topic: null,
      })
      .returning({ id: universityCommunityPosts.id });

    const comment = await request(local.via(app))
      .post(`/api/portal/university/community/posts/${agentPost.id}/comments`)
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ body: "a real member replies to the agent" });
    expect(comment.status).toBe(201);

    // Community behavior preserved: the comment lands and the count bumps.
    const [postRow] = await db
      .select()
      .from(universityCommunityPosts)
      .where(eq(universityCommunityPosts.id, agentPost.id));
    expect(postRow.commentCount).toBe(1);

    // No reply notification was written for the agent recipient.
    const notes = await db.select().from(universityCommunityNotifications);
    expect(notes).toHaveLength(0);

    // And no reply email was dispatched to the agent+ address.
    expect(vi.mocked(sendCreditscoreEmail)).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: AGENT_EMAIL }),
    );
  });

  it("reaction is idempotent and maintains reaction_count; un-react decrements", async () => {
    const post = await createPost(memberCookie(), "resonate with this");

    const react1 = await request(local.via(app))
      .post("/api/portal/university/community/react")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ targetType: "post", targetId: post.id });
    expect(react1.status).toBe(200);
    expect(react1.body.reactionCount).toBe(1);
    expect(react1.body.youReacted).toBe(true);

    // Double-tap is a no-op (idempotent), not an error.
    const react2 = await request(local.via(app))
      .post("/api/portal/university/community/react")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ targetType: "post", targetId: post.id });
    expect(react2.status).toBe(200);
    expect(react2.body.reactionCount).toBe(1);

    const reactionRows = await db.select().from(universityCommunityReactions);
    expect(reactionRows).toHaveLength(1);

    const [postRow] = await db
      .select()
      .from(universityCommunityPosts)
      .where(eq(universityCommunityPosts.id, post.id!));
    expect(postRow.reactionCount).toBe(1);

    // The reactor sees youReacted in the feed.
    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", member2Cookie());
    expect(feed.body.posts[0].youReacted).toBe(true);
    expect(feed.body.posts[0].reactionCount).toBe(1);

    // Un-react deletes the row and decrements.
    const unreact = await request(local.via(app))
      .delete("/api/portal/university/community/react")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ targetType: "post", targetId: post.id });
    expect(unreact.status).toBe(200);
    expect(unreact.body.reactionCount).toBe(0);
    expect(unreact.body.youReacted).toBe(false);

    const reactionRowsAfter = await db
      .select()
      .from(universityCommunityReactions);
    expect(reactionRowsAfter).toHaveLength(0);
    const [postRowAfter] = await db
      .select()
      .from(universityCommunityPosts)
      .where(eq(universityCommunityPosts.id, post.id!));
    expect(postRowAfter.reactionCount).toBe(0);
  });

  it("report → auto-hide at threshold removes the post from the feed", async () => {
    // member1 posts; two distinct members report → threshold (2) → hidden.
    const post = await createPost(memberCookie(), "this gets reported");

    const r1 = await request(local.via(app))
      .post("/api/portal/university/community/report")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ targetType: "post", targetId: post.id, reason: "spam" });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ ok: true }); // never reveals counts

    // Still visible after one report (threshold is 2).
    let feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", memberCookie());
    expect(feed.body.posts).toHaveLength(1);

    // A second reporter (the author here, for test simplicity — a distinct
    // reporter_email) crosses the threshold.
    const r2 = await request(local.via(app))
      .post("/api/portal/university/community/report")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ targetType: "post", targetId: post.id });
    expect(r2.status).toBe(200);

    feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", memberCookie());
    expect(feed.body.posts).toHaveLength(0); // auto-hidden

    const [postRow] = await db
      .select()
      .from(universityCommunityPosts)
      .where(eq(universityCommunityPosts.id, post.id!));
    expect(postRow.status).toBe("hidden");
    expect(postRow.hiddenReason).toBe("report");
  });

  it("re-report by the same member is idempotent (no report-spam)", async () => {
    const post = await createPost(memberCookie(), "report me twice");
    await request(local.via(app))
      .post("/api/portal/university/community/report")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ targetType: "post", targetId: post.id });
    await request(local.via(app))
      .post("/api/portal/university/community/report")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ targetType: "post", targetId: post.id });
    const reports = await db.select().from(universityCommunityReports);
    expect(reports).toHaveLength(1);
    // One distinct reporter → below threshold → still visible.
    const [postRow] = await db
      .select()
      .from(universityCommunityPosts)
      .where(eq(universityCommunityPosts.id, post.id!));
    expect(postRow.status).toBe("visible");
  });

  it("author can soft-delete their own post; it leaves the feed", async () => {
    const post = await createPost(memberCookie(), "delete me");
    const del = await request(local.via(app))
      .delete(`/api/portal/university/community/posts/${post.id}`)
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie());
    expect(del.status).toBe(200);

    const feed = await request(local.via(app))
      .get("/api/portal/university/community/feed")
      .set("Cookie", memberCookie());
    expect(feed.body.posts).toHaveLength(0);

    // Non-author cannot delete (404 — not theirs).
    const post2 = await createPost(memberCookie(), "not yours");
    const del2 = await request(local.via(app))
      .delete(`/api/portal/university/community/posts/${post2.id}`)
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie());
    expect(del2.status).toBe(404);
  });

  it("feed cursor pagination is stable (newest first, no overlap)", async () => {
    // Create 5 posts in order; serialize the awaits so created_at is ordered.
    const bodies = ["p1", "p2", "p3", "p4", "p5"];
    for (const b of bodies) {
      const r = await createPost(memberCookie(), b);
      expect(r.status).toBe(201);
    }

    const page1 = await request(local.via(app))
      .get("/api/portal/university/community/feed?limit=2")
      .set("Cookie", memberCookie());
    expect(page1.body.posts).toHaveLength(2);
    expect(page1.body.posts[0].body).toBe("p5"); // newest first
    expect(page1.body.posts[1].body).toBe("p4");
    expect(typeof page1.body.nextCursor).toBe("string");

    const page2 = await request(local.via(app))
      .get(
        `/api/portal/university/community/feed?limit=2&cursor=${encodeURIComponent(
          page1.body.nextCursor,
        )}`,
      )
      .set("Cookie", memberCookie());
    expect(page2.body.posts).toHaveLength(2);
    expect(page2.body.posts[0].body).toBe("p3");
    expect(page2.body.posts[1].body).toBe("p2");

    const page3 = await request(local.via(app))
      .get(
        `/api/portal/university/community/feed?limit=2&cursor=${encodeURIComponent(
          page2.body.nextCursor,
        )}`,
      )
      .set("Cookie", memberCookie());
    expect(page3.body.posts).toHaveLength(1);
    expect(page3.body.posts[0].body).toBe("p1");
    expect(page3.body.nextCursor).toBeNull();
  });

  it("per-member write rate limit returns 429 over the ceiling", async () => {
    // Build a fresh app whose post limiter ceiling is 1/min (env is read at
    // portalRoutes() construction). The 2nd post in the window is throttled.
    const prev = process.env.COMMUNITY_POST_RATE_PER_MIN;
    process.env.COMMUNITY_POST_RATE_PER_MIN = "1";
    const tightApp = express();
    tightApp.use(express.json());
    tightApp.use("/api/portal", portalRoutes(db));
    tightApp.use(errorHandler);
    process.env.COMMUNITY_POST_RATE_PER_MIN = prev; // restore for other apps

    const first = await request(local.via(tightApp))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ body: "first under limit" });
    expect(first.status).toBe(201);

    const second = await request(local.via(tightApp))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ body: "second over limit" });
    expect(second.status).toBe(429);

    // A DIFFERENT member is keyed separately — not throttled by member1's burst.
    const other = await request(local.via(tightApp))
      .post("/api/portal/university/community/posts")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ body: "different member, own bucket" });
    expect(other.status).toBe(201);
  });

  it("post detail returns the thread (oldest first) and 404 for a hidden/missing post", async () => {
    const post = await createPost(memberCookie(), "thread root");
    await request(local.via(app))
      .post(`/api/portal/university/community/posts/${post.id}/comments`)
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ body: "first comment" });
    await request(local.via(app))
      .post(`/api/portal/university/community/posts/${post.id}/comments`)
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", member2Cookie())
      .send({ body: "second comment" });

    const detail = await request(local.via(app))
      .get(`/api/portal/university/community/posts/${post.id}`)
      .set("Cookie", memberCookie());
    expect(detail.status).toBe(200);
    expect(detail.body.post.body).toBe("thread root");
    expect(detail.body.comments).toHaveLength(2);
    expect(detail.body.comments[0].body).toBe("first comment"); // oldest first
    expect(detail.body.comments[1].body).toBe("second comment");

    const missing = await request(local.via(app))
      .get(
        "/api/portal/university/community/posts/00000000-0000-0000-0000-000000000000",
      )
      .set("Cookie", memberCookie());
    expect(missing.status).toBe(404);
  });
});
