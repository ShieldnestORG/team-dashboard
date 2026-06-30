// ---------------------------------------------------------------------------
// Coherent Ones University — LIVE SESSIONS backend test (no live Stripe, no
// network, no live video API). The "Practice together" leg of the Coherent
// Loop: admin-scheduled sits, member RSVP, reminders, join-gating, .ics.
//
// Integration tests against a REAL embedded Postgres with the full migration
// chain applied (incl. 0127_university_sessions), through the REAL mounted
// Express portal route, authenticated with a real issueSession() cookie. Plus
// service-level tests for the two highest-risk pieces called out in the design:
// the live-state + join_url gating, and the reminder-window exactly-once
// delivery. Proves:
//   - 403 for a logged-in NON-member (membership gate)
//   - 403 under impersonation on mutations (read-only)
//   - RSVP upsert is idempotent; cancel-RSVP is soft + idempotent
//   - capacity full → 409 (and a re-RSVP by an already-going member is fine)
//   - join_url is returned ONLY when the session is live AND caller RSVP'd
//     going — never before the window, never to non-RSVPs
//   - admin create/patch/cancel gated on the env allow-list
//   - .ics is a valid single-VEVENT with UTC DTSTART/DTEND + the join link
//   - reminder windowing: a session ~24h/~1h out fires its RSVPs exactly once,
//     and one outside the window fires none
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-notes.test.ts. The skip prints its reason.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The portal service + crons import the email callback at module load. Mock it
// so nothing touches the network AND so we can assert reminder fan-out. The
// mock fn is created via vi.hoisted so it exists when the hoisted factory runs.
const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(async () => undefined),
}));
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: sendEmailMock,
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
  universitySessions,
  universitySessionRsvps,
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
import {
  universitySessionsService,
  isSessionLive,
  renderIcs,
  JOIN_OPENS_BEFORE_MINUTES,
  JOIN_GRACE_AFTER_MINUTES,
} from "../services/university-sessions.js";
import {
  runUniversitySessionReminder24h,
  runUniversitySessionReminder1h,
  runUniversitySessionStartingNow,
  runUniversitySessionRecap,
} from "../services/university-crons.js";

const PORTAL_SECRET = "test-test-test-test-test-test-test-test-secret"; // >= 32 chars
const MEMBER_EMAIL = "member@sessions.test";
const NONMEMBER_EMAIL = "nonmember@sessions.test";
const ADMIN_EMAIL = "admin@sessions.test";
const OTHER_MEMBER_EMAIL = "other@sessions.test";

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
    `Skipping university sessions integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university sessions integration test: pgvector unavailable — running ` +
      `against real Postgres with the vector(N)→text migration shim. Reason: ${
        support.reason ?? "unknown"
      }`,
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describeDb("university sessions endpoints (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;
  let memberAccountId!: string;
  let nonMemberAccountId!: string;
  let adminAccountId!: string;
  let otherMemberAccountId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;
    process.env.PORTAL_BASE_URL = "https://app.test.local";
    process.env.NODE_ENV = "development"; // skip Secure cookie attribute
    process.env.PORTAL_COOKIE_DOMAIN = "";
    process.env.UNIVERSITY_SESSION_ADMINS = `${ADMIN_EMAIL}, someone-else@x.test`;

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-sessions-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-sessions-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // Seed four customer_accounts: member, non-member, admin (also a member),
    // and a second member (for capacity + non-RSVP gating).
    const seedAccount = async (email: string) => {
      const [row] = await db
        .insert(customerAccounts)
        .values({ email })
        .returning();
      return row.id;
    };
    memberAccountId = await seedAccount(MEMBER_EMAIL);
    nonMemberAccountId = await seedAccount(NONMEMBER_EMAIL);
    adminAccountId = await seedAccount(ADMIN_EMAIL);
    otherMemberAccountId = await seedAccount(OTHER_MEMBER_EMAIL);

    // Members (active). Non-member intentionally has no university_members row.
    await db.insert(universityMembers).values([
      {
        accountId: memberAccountId,
        email: MEMBER_EMAIL,
        displayName: "Casey Member",
        status: "active",
        joinedAt: new Date(),
      },
      {
        accountId: adminAccountId,
        email: ADMIN_EMAIL,
        displayName: "Admin Person",
        status: "active",
        joinedAt: new Date(),
      },
      {
        accountId: otherMemberAccountId,
        email: OTHER_MEMBER_EMAIL,
        displayName: "Other One",
        status: "active",
        joinedAt: new Date(),
      },
    ]);

    app = express();
    app.use(express.json());
    app.use("/api/portal", portalRoutes(db));
    app.use(errorHandler);
  }, 60_000);

  afterEach(async () => {
    sendEmailMock.mockClear();
    await db.delete(universitySessionRsvps);
    await db.delete(universitySessions);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  function cookieFor(accountId: string): string {
    return `${PORTAL_SESSION_COOKIE}=${issueSession(accountId)}`;
  }
  const memberCookie = () => cookieFor(memberAccountId);
  const nonMemberCookie = () => cookieFor(nonMemberAccountId);
  const adminCookie = () => cookieFor(adminAccountId);
  const otherMemberCookie = () => cookieFor(otherMemberAccountId);

  function impersonationCookie(targetAccountId: string): string {
    const { value } = issueImpersonationCookie({
      adminActorId: "admin-actor",
      targetAccountId,
    });
    return `${ADMIN_IMPERSONATION_COOKIE}=${value}`;
  }

  // Insert a session directly (admin path is covered separately).
  async function seedSession(overrides: Partial<{
    title: string;
    startsAt: Date;
    durationMinutes: number;
    joinUrl: string;
    capacity: number | null;
    status: string;
  }> = {}): Promise<string> {
    const [row] = await db
      .insert(universitySessions)
      .values({
        title: overrides.title ?? "Sunday Coherence Sit",
        hostName: "Mark",
        startsAt: overrides.startsAt ?? new Date(Date.now() + 2 * HOUR),
        durationMinutes: overrides.durationMinutes ?? 60,
        joinUrl: overrides.joinUrl ?? "https://whereby.com/coherence-room",
        capacity: overrides.capacity ?? null,
        status: overrides.status ?? "scheduled",
      })
      .returning();
    return row.id;
  }

  // ----- Membership + auth gates -------------------------------------------

  it("401 without a session cookie", async () => {
    const res = await request(app).get("/api/portal/university/sessions");
    expect(res.status).toBe(401);
  });

  it("403 for a logged-in NON-member on list / rsvp / admin create", async () => {
    const sessionId = await seedSession();

    const list = await request(app)
      .get("/api/portal/university/sessions")
      .set("Cookie", nonMemberCookie());
    expect(list.status).toBe(403);

    const rsvp = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", nonMemberCookie());
    expect(rsvp.status).toBe(403);

    const create = await request(app)
      .post("/api/portal/university/sessions")
      .set("Cookie", nonMemberCookie())
      .send({
        title: "x",
        hostName: "Mark",
        startsAt: new Date(Date.now() + HOUR).toISOString(),
        joinUrl: "https://whereby.com/x",
      });
    expect(create.status).toBe(403);

    // Nothing RSVP'd.
    const rows = await db.select().from(universitySessionRsvps);
    expect(rows).toHaveLength(0);
  });

  it("403 under impersonation on RSVP (read-only)", async () => {
    const sessionId = await seedSession();
    const res = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", impersonationCookie(memberAccountId));
    expect(res.status).toBe(403);
    expect(res.body.impersonating).toBe(true);

    const rows = await db.select().from(universitySessionRsvps);
    expect(rows).toHaveLength(0);
  });

  // ----- RSVP lifecycle -----------------------------------------------------

  it("RSVP upsert is idempotent; cancel is soft + idempotent", async () => {
    const sessionId = await seedSession();

    const first = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(first.status).toBe(200);
    expect(first.body.session.myRsvp).toBe("going");
    expect(first.body.session.goingCount).toBe(1);

    // Re-RSVP → still one row, still going.
    const second = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(second.status).toBe(200);
    expect(second.body.session.goingCount).toBe(1);

    let rows = await db.select().from(universitySessionRsvps);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("going");
    expect(rows[0].email).toBe(MEMBER_EMAIL);
    expect(rows[0].accountId).toBe(memberAccountId);

    // Cancel → soft (row stays, status canceled).
    const cancel = await request(app)
      .delete(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(cancel.status).toBe(200);
    expect(cancel.body.ok).toBe(true);

    rows = await db.select().from(universitySessionRsvps);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("canceled");

    // Cancel again → idempotent 200.
    const cancelAgain = await request(app)
      .delete(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(cancelAgain.status).toBe(200);

    // Re-RSVP after cancel flips back to going (no new row).
    const reRsvp = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(reRsvp.status).toBe(200);
    expect(reRsvp.body.session.myRsvp).toBe("going");
    rows = await db.select().from(universitySessionRsvps);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("going");
  });

  it("cancel-RSVP on a missing session → 404", async () => {
    const res = await request(app)
      .delete(
        "/api/portal/university/sessions/00000000-0000-0000-0000-000000000000/rsvp",
      )
      .set("Cookie", memberCookie());
    expect(res.status).toBe(404);
  });

  it("capacity full → 409 for a new member; already-going re-RSVP is fine", async () => {
    const sessionId = await seedSession({ capacity: 1 });

    // First member claims the only seat.
    const a = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(a.status).toBe(200);

    // Same member re-RSVPing is NOT blocked (no new seat).
    const aAgain = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(aAgain.status).toBe(200);

    // A different member is rejected — full.
    const b = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", otherMemberCookie());
    expect(b.status).toBe(409);
    expect(b.body.error).toMatch(/full/i);

    const going = (await db.select().from(universitySessionRsvps)).filter(
      (r) => r.status === "going",
    );
    expect(going).toHaveLength(1);
  });

  it("RSVP to a canceled session → 400", async () => {
    const sessionId = await seedSession({ status: "canceled" });
    const res = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(res.status).toBe(400);
  });

  it("RSVP to an already-ended session → 400", async () => {
    const sessionId = await seedSession({
      startsAt: new Date(Date.now() - 5 * HOUR),
      durationMinutes: 60,
    });
    const res = await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    expect(res.status).toBe(400);
  });

  // ----- The join-gate (highest-risk: room-link leak) -----------------------

  it("join_url hidden for a FUTURE session even when RSVP'd", async () => {
    const sessionId = await seedSession({
      startsAt: new Date(Date.now() + 2 * HOUR),
    });
    await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());

    const list = await request(app)
      .get("/api/portal/university/sessions?scope=upcoming")
      .set("Cookie", memberCookie());
    expect(list.status).toBe(200);
    const s = list.body.sessions.find((x: { id: string }) => x.id === sessionId);
    expect(s).toBeTruthy();
    expect(s.isLive).toBe(false);
    expect(s.joinUrl).toBeUndefined();
  });

  it("join_url revealed only when LIVE and RSVP'd; hidden for a live non-RSVP", async () => {
    // Live now: started 5 min ago, 60 min long.
    const sessionId = await seedSession({
      startsAt: new Date(Date.now() - 5 * MINUTE),
      durationMinutes: 60,
      joinUrl: "https://whereby.com/live-room",
    });

    // RSVP'd member sees the link.
    await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());
    const mine = await request(app)
      .get("/api/portal/university/sessions?scope=upcoming")
      .set("Cookie", memberCookie());
    const s = mine.body.sessions.find((x: { id: string }) => x.id === sessionId);
    expect(s.isLive).toBe(true);
    expect(s.joinUrl).toBe("https://whereby.com/live-room");

    // A live non-RSVP member does NOT get the link.
    const other = await request(app)
      .get("/api/portal/university/sessions?scope=upcoming")
      .set("Cookie", otherMemberCookie());
    const so = other.body.sessions.find(
      (x: { id: string }) => x.id === sessionId,
    );
    expect(so.isLive).toBe(true);
    expect(so.myRsvp).toBeNull();
    expect(so.joinUrl).toBeUndefined();
  });

  it("isSessionLive respects the early-open window and excludes canceled", () => {
    const startsAt = new Date("2026-07-01T18:00:00Z");
    const base = { startsAt, durationMinutes: 60, status: "scheduled" };
    // Just inside the early-open window.
    const justOpened = new Date(
      startsAt.getTime() - (JOIN_OPENS_BEFORE_MINUTES - 1) * MINUTE,
    );
    expect(isSessionLive(base, justOpened)).toBe(true);
    // Well before the window.
    expect(
      isSessionLive(base, new Date(startsAt.getTime() - 2 * HOUR)),
    ).toBe(false);
    // Canceled is never live, even mid-window.
    expect(
      isSessionLive({ ...base, status: "canceled" }, startsAt),
    ).toBe(false);
  });

  // ----- .ics ---------------------------------------------------------------

  it("GET /ics returns a valid single-VEVENT calendar with UTC times + join link", async () => {
    const startsAt = new Date("2026-07-05T17:30:00Z");
    const sessionId = await seedSession({
      title: "Weekly Sit; with, commas",
      startsAt,
      durationMinutes: 45,
      joinUrl: "https://whereby.com/ics-room",
    });

    const res = await request(app)
      .get(`/api/portal/university/sessions/${sessionId}/ics`)
      .set("Cookie", memberCookie());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/calendar/);
    expect(res.headers["content-disposition"]).toMatch(/coherence-session\.ics/);

    const body = res.text;
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain(`UID:session-${sessionId}@coherencedaddy.com`);
    expect(body).toContain("DTSTART:20260705T173000Z");
    // 45 min later.
    expect(body).toContain("DTEND:20260705T181500Z");
    expect(body).toContain("URL:https://whereby.com/ics-room");
    // Commas/semicolons escaped in SUMMARY (RFC-5545 TEXT).
    expect(body).toContain("SUMMARY:Weekly Sit\\; with\\, commas");
    expect(body).toContain("BEGIN:VALARM");
    // Exactly one VEVENT.
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("GET /ics for a non-member → 403", async () => {
    const sessionId = await seedSession();
    const res = await request(app)
      .get(`/api/portal/university/sessions/${sessionId}/ics`)
      .set("Cookie", nonMemberCookie());
    expect(res.status).toBe(403);
  });

  it("renderIcs uses CRLF line endings", () => {
    const ics = renderIcs({
      id: "abc",
      title: "T",
      description: null,
      startsAt: new Date("2026-07-05T17:30:00Z"),
      durationMinutes: 30,
      joinUrl: "https://x.test/r",
    });
    expect(ics).toContain("\r\n");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  // ----- Admin authoring (env allow-list) -----------------------------------

  it("admin create rejected for a member NOT on the allow-list (403)", async () => {
    const res = await request(app)
      .post("/api/portal/university/sessions")
      .set("Cookie", memberCookie())
      .send({
        title: "New Sit",
        hostName: "Mark",
        startsAt: new Date(Date.now() + HOUR).toISOString(),
        joinUrl: "https://whereby.com/new",
      });
    expect(res.status).toBe(403);
  });

  it("admin create validates input (400 on past start / non-https url / bad duration)", async () => {
    const past = await request(app)
      .post("/api/portal/university/sessions")
      .set("Cookie", adminCookie())
      .send({
        title: "x",
        hostName: "Mark",
        startsAt: new Date(Date.now() - HOUR).toISOString(),
        joinUrl: "https://whereby.com/x",
      });
    expect(past.status).toBe(400);

    const badUrl = await request(app)
      .post("/api/portal/university/sessions")
      .set("Cookie", adminCookie())
      .send({
        title: "x",
        hostName: "Mark",
        startsAt: new Date(Date.now() + HOUR).toISOString(),
        joinUrl: "http://whereby.com/x",
      });
    expect(badUrl.status).toBe(400);

    const badDuration = await request(app)
      .post("/api/portal/university/sessions")
      .set("Cookie", adminCookie())
      .send({
        title: "x",
        hostName: "Mark",
        startsAt: new Date(Date.now() + HOUR).toISOString(),
        joinUrl: "https://whereby.com/x",
        durationMinutes: 10_000,
      });
    expect(badDuration.status).toBe(400);
  });

  it("admin create → patch → cancel happy path, cancel notifies going RSVPs", async () => {
    const startsAt = new Date(Date.now() + 3 * HOUR).toISOString();
    const created = await request(app)
      .post("/api/portal/university/sessions")
      .set("Cookie", adminCookie())
      .send({
        title: "Founder Sit",
        hostName: "Mark",
        startsAt,
        joinUrl: "https://whereby.com/founder",
        capacity: 25,
      });
    expect(created.status).toBe(200);
    const id = created.body.session.id;
    expect(created.body.session.status).toBe("scheduled");
    expect(created.body.session.joinUrl).toBe("https://whereby.com/founder");

    // A member RSVPs (so the cancel notice has a recipient).
    await request(app)
      .post(`/api/portal/university/sessions/${id}/rsvp`)
      .set("Cookie", memberCookie());

    // Patch the title.
    const patched = await request(app)
      .patch(`/api/portal/university/sessions/${id}`)
      .set("Cookie", adminCookie())
      .send({ title: "Founder Sit (renamed)" });
    expect(patched.status).toBe(200);
    expect(patched.body.session.title).toBe("Founder Sit (renamed)");

    sendEmailMock.mockClear();
    const canceled = await request(app)
      .post(`/api/portal/university/sessions/${id}/cancel`)
      .set("Cookie", adminCookie());
    expect(canceled.status).toBe(200);
    expect(canceled.body.session.status).toBe("canceled");

    // The going RSVP got a canceled notice.
    const cancelCalls = sendEmailMock.mock.calls.filter(
      (c) => c[0]?.kind === "university_session_canceled",
    );
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0][0].to).toBe(MEMBER_EMAIL);

    // RSVP rows are left intact (audit).
    const rows = await db.select().from(universitySessionRsvps);
    expect(rows).toHaveLength(1);
  });

  it("patch / cancel on a missing session → 404", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    const patch = await request(app)
      .patch(`/api/portal/university/sessions/${missing}`)
      .set("Cookie", adminCookie())
      .send({ title: "nope" });
    expect(patch.status).toBe(404);

    const cancel = await request(app)
      .post(`/api/portal/university/sessions/${missing}/cancel`)
      .set("Cookie", adminCookie());
    expect(cancel.status).toBe(404);
  });

  // ----- Past scope ---------------------------------------------------------

  it("scope=past returns ended sessions, newest first", async () => {
    const older = await seedSession({
      title: "Older",
      startsAt: new Date(Date.now() - 10 * HOUR),
    });
    const newer = await seedSession({
      title: "Newer",
      startsAt: new Date(Date.now() - 2 * HOUR),
    });
    // A future one should NOT appear in past.
    await seedSession({
      title: "Future",
      startsAt: new Date(Date.now() + 5 * HOUR),
    });

    const res = await request(app)
      .get("/api/portal/university/sessions?scope=past")
      .set("Cookie", memberCookie());
    expect(res.status).toBe(200);
    const ids = res.body.sessions.map((s: { id: string }) => s.id);
    expect(ids).toContain(older);
    expect(ids).toContain(newer);
    // Newest-first ordering.
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(res.body.sessions.every((s: { joinUrl?: string }) => !s.joinUrl)).toBe(
      true,
    );
  });

  // ----- Admin reads (env allow-list) — join_url leak guard ------------------
  // The admin GET :id returns the full AdminSession (join_url ALWAYS present)
  // and GET :id/rsvps returns the attendee roster. Both are gated on
  // requireSessionAdmin (membership AND the UNIVERSITY_SESSION_ADMINS list).
  // The leak risk: the always-join-url AdminSession reaching a non-admin.

  it("admin GET :id returns 200 with joinUrl in the full AdminSession shape", async () => {
    const sessionId = await seedSession({
      joinUrl: "https://whereby.com/admin-room",
      capacity: 25,
    });

    const res = await request(app)
      .get(`/api/portal/university/sessions/${sessionId}`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    const s = res.body.session;
    expect(s.id).toBe(sessionId);
    // join_url is ALWAYS included in the admin shape (un-gated).
    expect(s.joinUrl).toBe("https://whereby.com/admin-room");
    // Full AdminSession fields the member view never exposes unconditionally.
    expect(s.status).toBe("scheduled");
    expect(s.capacity).toBe(25);
    expect(typeof s.startsAt).toBe("string");
    expect(typeof s.createdAt).toBe("string");
    expect(typeof s.updatedAt).toBe("string");
  });

  it("LEAK GUARD: admin GET :id is 403 for a valid member NOT on the allow-list — never leaks joinUrl", async () => {
    const sessionId = await seedSession({
      joinUrl: "https://whereby.com/secret-room",
    });

    // memberCookie() is a real, active University member — but not an admin.
    const res = await request(app)
      .get(`/api/portal/university/sessions/${sessionId}`)
      .set("Cookie", memberCookie());
    expect(res.status).toBe(403);
    // The room link must never appear in a non-admin response body.
    expect(JSON.stringify(res.body)).not.toContain("secret-room");
  });

  it("LEAK GUARD: admin GET :id/rsvps is 403 for a valid member NOT on the allow-list", async () => {
    const sessionId = await seedSession();

    const res = await request(app)
      .get(`/api/portal/university/sessions/${sessionId}/rsvps`)
      .set("Cookie", otherMemberCookie());
    expect(res.status).toBe(403);
    expect(res.body.rsvps).toBeUndefined();
  });

  it("LEAK GUARD: both admin reads are 403 when the allow-list is EMPTY (admin disabled), even for an allow-listed email", async () => {
    const sessionId = await seedSession({
      joinUrl: "https://whereby.com/disabled-room",
    });
    const prev = process.env.UNIVERSITY_SESSION_ADMINS;
    process.env.UNIVERSITY_SESSION_ADMINS = "";
    try {
      // Even the normally-admin account is denied when admin is not enabled.
      const get = await request(app)
        .get(`/api/portal/university/sessions/${sessionId}`)
        .set("Cookie", adminCookie());
      expect(get.status).toBe(403);
      expect(JSON.stringify(get.body)).not.toContain("disabled-room");

      const rsvps = await request(app)
        .get(`/api/portal/university/sessions/${sessionId}/rsvps`)
        .set("Cookie", adminCookie());
      expect(rsvps.status).toBe(403);
      expect(rsvps.body.rsvps).toBeUndefined();
    } finally {
      process.env.UNIVERSITY_SESSION_ADMINS = prev;
    }
  });

  it("admin GET :id/rsvps resolves name from displayName; null for an email-only RSVP", async () => {
    const sessionId = await seedSession();

    // A real member RSVP (name should resolve from university_members).
    await request(app)
      .post(`/api/portal/university/sessions/${sessionId}/rsvp`)
      .set("Cookie", memberCookie());

    // An email-only RSVP with NO university_members row (name → null). Insert
    // directly; seeded later so createdAt sorts after the member RSVP.
    await db.insert(universitySessionRsvps).values({
      sessionId,
      email: "guest-no-member@sessions.test",
      accountId: null,
      status: "going",
    });

    const res = await request(app)
      .get(`/api/portal/university/sessions/${sessionId}/rsvps`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    const roster: Array<{
      email: string;
      name: string | null;
      accountId: string | null;
      status: string;
    }> = res.body.rsvps;

    const member = roster.find((r) => r.email === MEMBER_EMAIL);
    expect(member).toBeTruthy();
    expect(member!.name).toBe("Casey Member");
    expect(member!.accountId).toBe(memberAccountId);
    expect(member!.status).toBe("going");

    const guest = roster.find(
      (r) => r.email === "guest-no-member@sessions.test",
    );
    expect(guest).toBeTruthy();
    expect(guest!.name).toBeNull();
    expect(guest!.accountId).toBeNull();
  });

  it("admin GET :id and :id/rsvps → 404 for a non-existent session", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";

    const get = await request(app)
      .get(`/api/portal/university/sessions/${missing}`)
      .set("Cookie", adminCookie());
    expect(get.status).toBe(404);

    const rsvps = await request(app)
      .get(`/api/portal/university/sessions/${missing}/rsvps`)
      .set("Cookie", adminCookie());
    expect(rsvps.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Reminder windowing — exactly-once delivery (highest-risk #2). Service-level,
// driving the real cron functions against the real DB.
// ---------------------------------------------------------------------------

describeDb("university session reminder crons (windowing)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let svc!: ReturnType<typeof universitySessionsService>;
  let rsvpAccountId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-sess-crons-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-sess-crons-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }
    svc = universitySessionsService(db);

    const [acct] = await db
      .insert(customerAccounts)
      .values({ email: "rsvp@crons.test" })
      .returning();
    rsvpAccountId = acct.id;
    await db.insert(universityMembers).values({
      accountId: rsvpAccountId,
      email: "rsvp@crons.test",
      displayName: "Rae Rsvp",
      status: "active",
      joinedAt: new Date(),
    });
  }, 60_000);

  afterEach(async () => {
    sendEmailMock.mockClear();
    await db.delete(universitySessionRsvps);
    await db.delete(universitySessions);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedRsvpdSession(startsAt: Date): Promise<string> {
    const row = await svc.createSession({
      title: "Reminder Sit",
      hostName: "Mark",
      startsAt,
      joinUrl: "https://whereby.com/reminder",
    });
    await svc.rsvp(rsvpAccountId, row.id, new Date(Date.now() - 1 * HOUR));
    return row.id;
  }

  it("24h reminder fires for a session ~23.5h out, exactly once; not for one 30h out", async () => {
    // In-window: 23h30m from now (∈ [now+23h, now+24h)).
    await seedRsvpdSession(new Date(Date.now() + 23.5 * HOUR));
    // Out-of-window: 30h out.
    await seedRsvpdSession(new Date(Date.now() + 30 * HOUR));

    const sent = await runUniversitySessionReminder24h(db);
    expect(sent).toBe(1);

    const calls = sendEmailMock.mock.calls.filter(
      (c) => c[0]?.kind === "university_session_reminder_24h",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0].to).toBe("rsvp@crons.test");
    expect(calls[0][0].data.firstName).toBe("Rae");
    expect(typeof calls[0][0].data.startsAtIso).toBe("string");
  });

  it("1h reminder fires for a session ~90m out; canceled sessions excluded", async () => {
    // In the 1h window [now+1h, now+2h): 90 minutes out.
    const inWindow = await seedRsvpdSession(new Date(Date.now() + 90 * MINUTE));
    // Also in the window but the SESSION is canceled → excluded.
    const canceledId = await seedRsvpdSession(
      new Date(Date.now() + 80 * MINUTE),
    );
    await svc.cancelSession(canceledId);

    const sent = await runUniversitySessionReminder1h(db);
    expect(sent).toBe(1);

    const calls = sendEmailMock.mock.calls.filter(
      (c) => c[0]?.kind === "university_session_reminder_1h",
    );
    expect(calls).toHaveLength(1);
    // The in-window, non-canceled session's RSVP was the recipient.
    expect(inWindow).toBeTruthy();
  });

  it("canceled RSVPs are not reminded", async () => {
    const id = await seedRsvpdSession(new Date(Date.now() + 90 * MINUTE));
    await svc.cancelRsvp(rsvpAccountId, id);

    const sent = await runUniversitySessionReminder1h(db);
    expect(sent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-minute crons — "starting now" + recap. These sweep every wall-clock
// minute and MUST be exactly-once via MINUTE-ALIGNED, DISJOINT windows derived
// from date_trunc('minute', now()) — NOT downstream messageId dedup (the
// landing receiver does not dedup). The boundary cases below prove the slices
// tile perfectly: a session whose start lands on a minute boundary is emailed
// in exactly ONE minute's sweep, never two.
//
// Windows under test:
//   starting-now: starts_at  ∈ [M,      M + 1m)   where M = date_trunc(min,now)
//   recap:        ended_at   ∈ [M - 1m, M)        ended_at = start+dur+grace
// ---------------------------------------------------------------------------

describeDb("university per-minute session crons (minute-aligned windows)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let svc!: ReturnType<typeof universitySessionsService>;
  let rsvpAccountId!: string;

  beforeAll(async () => {
    process.env.PORTAL_SESSION_SECRET = PORTAL_SECRET;

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-perminute-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-perminute-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }
    svc = universitySessionsService(db);

    const [acct] = await db
      .insert(customerAccounts)
      .values({ email: "rsvp@perminute.test" })
      .returning();
    rsvpAccountId = acct.id;
    await db.insert(universityMembers).values({
      accountId: rsvpAccountId,
      email: "rsvp@perminute.test",
      displayName: "Min Boundary",
      status: "active",
      joinedAt: new Date(),
    });
  }, 60_000);

  afterEach(async () => {
    sendEmailMock.mockClear();
    await db.delete(universitySessionRsvps);
    await db.delete(universitySessions);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  // These tests pin session times relative to the current minute boundary M,
  // while the cron derives its own M from SQL date_trunc('minute', now()). If a
  // test straddled a wall-clock minute edge between the JS floor and the SQL
  // floor the two M's would differ by a minute and the assertion would flake.
  // We avoid that by NEVER running these assertions in the last/first ~3s of a
  // minute: wait out the danger zone first, then JS and SQL agree on M for the
  // whole body. (The 5s margin is generous vs. the sub-ms gap between seed and
  // cron run.)
  async function settleIntoMinute(): Promise<void> {
    const secondsIntoMinute = (Date.now() % 60_000) / 1000;
    const SAFE_LO = 3;
    const SAFE_HI = 55;
    if (secondsIntoMinute < SAFE_LO) {
      await new Promise((r) => setTimeout(r, (SAFE_LO - secondsIntoMinute) * 1000 + 200));
    } else if (secondsIntoMinute > SAFE_HI) {
      // Too close to the next minute — wait it out, then we're early in the new one.
      await new Promise((r) => setTimeout(r, (60 - secondsIntoMinute + SAFE_LO) * 1000 + 200));
    }
  }

  // The current minute boundary M, floored the same way the cron floors in SQL
  // (date_trunc('minute', now())). Call settleIntoMinute() first.
  function currentMinuteBoundary(): Date {
    const m = new Date();
    m.setUTCSeconds(0, 0);
    return m;
  }

  // Insert a scheduled session directly at the EXACT instant we want (the
  // createSession path rejects non-future starts; the column has no such
  // constraint, and the cron reads only the column). A going RSVP is inserted
  // directly too, mirroring the email-only-RSVP seed in the integration block.
  async function seedSessionAt(
    startsAt: Date,
    durationMinutes = 60,
    recordingUrl: string | null = null,
  ): Promise<string> {
    const [row] = await db
      .insert(universitySessions)
      .values({
        title: "Minute Sit",
        hostName: "Mark",
        startsAt,
        durationMinutes,
        joinUrl: "https://whereby.com/minute-room",
        capacity: null,
        status: "scheduled",
        recordingUrl,
      })
      .returning();
    await db.insert(universitySessionRsvps).values({
      sessionId: row.id,
      email: "rsvp@perminute.test",
      accountId: rsvpAccountId,
      status: "going",
    });
    return row.id;
  }

  // ----- starting-now --------------------------------------------------------

  it("starting-now fires for a session starting THIS minute; not one starting next minute", async () => {
    await settleIntoMinute();
    const m = currentMinuteBoundary();
    // In-window: 30s into the current minute → ∈ [M, M+1m).
    await seedSessionAt(new Date(m.getTime() + 30 * 1000));
    // Out-of-window: 30s into the NEXT minute → ∈ [M+1m, M+2m), so the M sweep
    // must NOT pick it up (it belongs to next minute's sweep).
    await seedSessionAt(new Date(m.getTime() + 90 * 1000));

    const sent = await runUniversitySessionStartingNow(db);
    expect(sent).toBe(1);

    const calls = sendEmailMock.mock.calls.filter(
      (c) => c[0]?.kind === "university_session_starting_now",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0].to).toBe("rsvp@perminute.test");
    // The live email carries the real join_url.
    expect(calls[0][0].data.joinUrl).toBe("https://whereby.com/minute-room");
  });

  it("BOUNDARY exactly-once: a start AT the boundary M lands in exactly ONE minute slice — the M sweep claims it, the M-1m slice does not", async () => {
    await settleIntoMinute();
    const m = currentMinuteBoundary();

    // (a) A session starting EXACTLY on M. Window [M, M+1m) has an INCLUSIVE
    // lower bound, so this minute's sweep claims it → exactly one send.
    await seedSessionAt(new Date(m.getTime()));
    const sentOnBoundary = await runUniversitySessionStartingNow(db);
    expect(sentOnBoundary).toBe(1);
    expect(
      sendEmailMock.mock.calls.filter(
        (c) => c[0]?.kind === "university_session_starting_now",
      ),
    ).toHaveLength(1);

    // Reset between the two halves so the second assertion is clean.
    sendEmailMock.mockClear();
    await db.delete(universitySessionRsvps);
    await db.delete(universitySessions);

    // (b) A session starting exactly one minute BEFORE M (i.e. on the boundary
    // of the PRIOR minute slice [M-1m, M)). The current sweep's window [M, M+1m)
    // has an EXCLUSIVE relationship to it — M-1m < M — so this sweep must NOT
    // claim it. That start was the prior sweep's responsibility. Adjacent
    // windows are disjoint: a boundary instant belongs to exactly one of them.
    await seedSessionAt(new Date(m.getTime() - 60 * 1000));
    const sentPriorBoundary = await runUniversitySessionStartingNow(db);
    expect(sentPriorBoundary).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("starting-now does NOT fire for a session that started a full minute ago", async () => {
    await settleIntoMinute();
    const m = currentMinuteBoundary();
    // starts_at = M - 90s → ∈ [M-2m, M-1m): well before the [M, M+1m) window.
    await seedSessionAt(new Date(m.getTime() - 90 * 1000));

    const sent = await runUniversitySessionStartingNow(db);
    expect(sent).toBe(0);
  });

  it("starting-now excludes canceled sessions", async () => {
    await settleIntoMinute();
    const m = currentMinuteBoundary();
    const id = await seedSessionAt(new Date(m.getTime() + 30 * 1000));
    await svc.cancelSession(id);

    const sent = await runUniversitySessionStartingNow(db);
    expect(sent).toBe(0);
  });

  // ----- recap ---------------------------------------------------------------

  it("recap fires for a session that ENDED in the previous minute; not one ending this minute", async () => {
    await settleIntoMinute();
    const m = currentMinuteBoundary();
    const grace = JOIN_GRACE_AFTER_MINUTES;
    // ended_at = starts_at + duration + grace. We want ended_at ∈ [M-1m, M).
    // Pick duration 60, so starts_at = endedAt - (60 + grace) minutes.
    const endedInPrevMinute = new Date(m.getTime() - 30 * 1000); // ∈ [M-1m, M)
    const recordingUrl = "https://zoom.us/rec/share/minute-sit-replay";
    await seedSessionAt(
      new Date(endedInPrevMinute.getTime() - (60 + grace) * MINUTE),
      60,
      recordingUrl,
    );
    // A session ending 30s into THIS minute (ended_at ∈ [M, M+1m)) must NOT
    // recap yet — it belongs to next minute's sweep.
    const endsThisMinute = new Date(m.getTime() + 30 * 1000);
    await seedSessionAt(
      new Date(endsThisMinute.getTime() - (60 + grace) * MINUTE),
      60,
    );

    const sent = await runUniversitySessionRecap(db);
    expect(sent).toBe(1);

    const calls = sendEmailMock.mock.calls.filter(
      (c) => c[0]?.kind === "university_session_recap",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0].to).toBe("rsvp@perminute.test");
    // The session's manual recording link flows through to the recap payload.
    expect(calls[0][0].data.recordingUrl).toBe(recordingUrl);
  });

  it("recap excludes canceled sessions", async () => {
    await settleIntoMinute();
    const m = currentMinuteBoundary();
    const grace = JOIN_GRACE_AFTER_MINUTES;
    const endedInPrevMinute = new Date(m.getTime() - 30 * 1000);
    const id = await seedSessionAt(
      new Date(endedInPrevMinute.getTime() - (60 + grace) * MINUTE),
      60,
    );
    await svc.cancelSession(id);

    const sent = await runUniversitySessionRecap(db);
    expect(sent).toBe(0);
  });
});
