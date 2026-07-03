// ---------------------------------------------------------------------------
// Coherent Ones University — member NOTES store backend test (no live Stripe,
// no network). The persisted in-lesson "write this down" prompts.
//
// Integration tests against a REAL embedded Postgres with the full migration
// chain applied (incl. 0124_university_notes), through the REAL mounted Express
// portal route, authenticated with a real issueSession() cookie. Proves:
//   - 403 for a logged-in NON-member (membership gate, GET + POST + DELETE)
//   - 400 on missing lessonSlug / noteKey
//   - POST saves a note and returns it
//   - SAME (lesson, noteKey) re-POST is idempotent (no duplicate row; body +
//     updated_at refreshed)
//   - GET returns the member's notes, newest first
//   - GET?lessonSlug=<slug> filters to a single lesson
//   - DELETE removes a note
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-progress.test.ts. The skip prints its reason.
//
// FUTURE: these member notes are the input corpus for a planned "smart pattern
// recognition" feature ported from the Optimize Me / architect app. Not built
// yet — this test only covers the persistence layer.
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
  universityNotes,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { portalRoutes } from "../routes/portal.js";
import { errorHandler } from "../middleware/index.js";
import { issueSession, PORTAL_SESSION_COOKIE } from "../services/customer-portal.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars
// Browsers send an Origin header on every unsafe (non-GET) request; the portal
// CSRF guard (middleware/portal-csrf.ts) fail-closes without a trusted one.
// Must match the PORTAL_BASE_URL this suite sets in beforeAll.
const TRUSTED_ORIGIN = "https://app.test.local";
const MEMBER_EMAIL = "member@notes.test";
const NONMEMBER_EMAIL = "nonmember@notes.test";

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
    `Skipping university notes integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university notes integration test: pgvector unavailable — running against ` +
      `real Postgres with the vector(N)→text migration shim. Reason: ${
        support.reason ?? "unknown"
      }`,
  );
}

describeDb("university notes endpoints (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  const local = useLocalServer();
  let memberAccountId!: string;
  let nonMemberAccountId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = TRUSTED_ORIGIN;
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase("university-notes-");
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-notes-novec-",
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
    await db.delete(universityNotes);
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
    const res = await request(local.via(app)).get("/api/portal/university/notes");
    expect(res.status).toBe(401);
  });

  it("403 for a logged-in NON-member on GET / POST / DELETE (membership gate)", async () => {
    const get = await request(local.via(app))
      .get("/api/portal/university/notes")
      .set("Cookie", nonMemberCookie());
    expect(get.status).toBe(403);

    const post = await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", nonMemberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "takeaway", body: "x" });
    expect(post.status).toBe(403);

    const del = await request(local.via(app))
      .delete("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", nonMemberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "takeaway" });
    expect(del.status).toBe(403);

    // Nothing written.
    const rows = await db.select().from(universityNotes);
    expect(rows).toHaveLength(0);
  });

  it("400 on missing lessonSlug or noteKey", async () => {
    const noLesson = await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ noteKey: "takeaway", body: "x" });
    expect(noLesson.status).toBe(400);

    const noKey = await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", body: "x" });
    expect(noKey.status).toBe(400);
  });

  it("POST saves a note and returns it", async () => {
    const res = await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({
        lessonSlug: "coherence-101",
        noteKey: "takeaway",
        body: "stay coherent",
      });
    expect(res.status).toBe(200);
    expect(res.body.note.lessonSlug).toBe("coherence-101");
    expect(res.body.note.noteKey).toBe("takeaway");
    expect(res.body.note.body).toBe("stay coherent");
    expect(typeof res.body.note.updatedAt).toBe("string");

    const rows = await db.select().from(universityNotes);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(MEMBER_EMAIL);
    expect(rows[0].accountId).toBe(memberAccountId);
    expect(rows[0].body).toBe("stay coherent");
  });

  it("SAME (lesson, noteKey) re-POST is idempotent: no duplicate row, body updated", async () => {
    const first = await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "takeaway", body: "first" });
    expect(first.status).toBe(200);
    const firstUpdatedAt = first.body.note.updatedAt;

    const second = await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "takeaway", body: "second" });
    expect(second.status).toBe(200);
    expect(second.body.note.body).toBe("second");

    const rows = await db.select().from(universityNotes);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("second");
    // updated_at bumped (>= the first write; not strictly greater on a fast clock).
    expect(
      new Date(second.body.note.updatedAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(firstUpdatedAt).getTime());
  });

  it("GET returns the member's notes, newest first, and filters by lesson", async () => {
    await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "takeaway", body: "a" });
    await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "question", body: "b" });
    await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-102", noteKey: "takeaway", body: "c" });

    const all = await request(local.via(app))
      .get("/api/portal/university/notes")
      .set("Cookie", memberCookie());
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body.notes)).toBe(true);
    expect(all.body.notes).toHaveLength(3);
    // Newest first → the last write (coherence-102) is first.
    expect(all.body.notes[0].lessonSlug).toBe("coherence-102");
    expect(all.body.notes[0]).toHaveProperty("noteKey");
    expect(all.body.notes[0]).toHaveProperty("body");
    expect(all.body.notes[0]).toHaveProperty("updatedAt");

    const filtered = await request(local.via(app))
      .get("/api/portal/university/notes?lessonSlug=coherence-101")
      .set("Cookie", memberCookie());
    expect(filtered.status).toBe(200);
    expect(filtered.body.notes).toHaveLength(2);
    expect(
      filtered.body.notes.every(
        (n: { lessonSlug: string }) => n.lessonSlug === "coherence-101",
      ),
    ).toBe(true);
  });

  it("DELETE removes a note", async () => {
    await request(local.via(app))
      .post("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "takeaway", body: "a" });

    const del = await request(local.via(app))
      .delete("/api/portal/university/notes")
      .set("Origin", TRUSTED_ORIGIN)
      .set("Cookie", memberCookie())
      .send({ lessonSlug: "coherence-101", noteKey: "takeaway" });
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const rows = await db.select().from(universityNotes);
    expect(rows).toHaveLength(0);
  });
});
