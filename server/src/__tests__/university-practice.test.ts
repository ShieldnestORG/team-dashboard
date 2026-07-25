// ---------------------------------------------------------------------------
// Coherent Education — member PRACTICE suite backend test (habits / journal /
// activities, migration 0158).
//
// Integration tests against a REAL embedded Postgres with the full migration
// chain applied (incl. 0158_university_practice), through the REAL mounted
// Express portal route, authenticated with a real issueSession() cookie.
// Proves:
//   - 401 without a session; 403 for a logged-in NON-member (membership gate)
//   - EVERY practice mutation is blocked under impersonation (read-only,
//     requireNonImpersonating — suite-asserted invariant)
//   - habits: create (defaults, duplicate-name 400, 50-active-cap 400), list
//     with last-30d completions map, update (partial, ownership → 404),
//     toggle (idempotent both ways, 7-day window, never a 409)
//   - journal: empty shell for an unwritten day, PARTIAL-merge upsert (a POST
//     carrying only { notes } keeps mit/gratitude), 30-day window, field caps
//   - activities: aggregate-only record + newest-first list, type allowlist,
//     startedAt window, integer range 400s
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching
// university-checkin.test.ts. The skip prints its reason.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The portal service imports the magic-link email callback at module load.
// No-op it so nothing touches the network (mirrors university-checkin.test.ts).
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
  universityHabits,
  universityHabitCompletions,
  universityJournalEntries,
  universityActivities,
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
const MEMBER_EMAIL = "member@practice.test";
const NONMEMBER_EMAIL = "nonmember@practice.test";
const OTHER_MEMBER_EMAIL = "other@practice.test";

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
    `Skipping university practice integration test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("university practice endpoints (integration)", () => {
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
    // Lift the per-member write ceilings for the functional suite — the
    // limiter's behaviour is the shared community limiter, covered elsewhere.
    process.env.UNIVERSITY_HABIT_EDIT_RATE_PER_MIN = "1000";
    process.env.UNIVERSITY_HABIT_RATE_PER_MIN = "1000";
    process.env.UNIVERSITY_JOURNAL_RATE_PER_MIN = "1000";
    process.env.UNIVERSITY_ACTIVITY_RATE_PER_MIN = "1000";

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-practice-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-practice-novec-",
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
    await db.delete(universityHabitCompletions);
    await db.delete(universityHabits);
    await db.delete(universityJournalEntries);
    await db.delete(universityActivities);
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

  function post(path: string, body: unknown, cookie?: string) {
    const req = request(local.via(app))
      .post(`/api/portal${path}`)
      .set("Origin", TRUSTED_ORIGIN)
      .send(body as object);
    return cookie ? req.set("Cookie", cookie) : req;
  }
  function get(path: string, cookie?: string) {
    const req = request(local.via(app)).get(`/api/portal${path}`);
    return cookie ? req.set("Cookie", cookie) : req;
  }

  async function createHabit(
    body: Record<string, unknown> = { name: "Read 10 pages" },
  ): Promise<{ id: string }> {
    const res = await post("/university/habits", body, memberCookie());
    expect(res.status).toBe(200);
    return res.body.habit;
  }

  const MUTATIONS: Array<[string, Record<string, unknown>]> = [
    ["/university/habits", { name: "x" }],
    ["/university/habits/update", { habitId: "x" }],
    ["/university/habits/toggle", { habitId: "x", done: true }],
    ["/university/journal", { day: "2026-01-01" }],
    [
      "/university/activities",
      {
        activityType: "run",
        startedAt: new Date().toISOString(),
        durationS: 60,
        distanceM: 100,
      },
    ],
  ];

  it("blocks EVERY practice mutation under impersonation (read-only 403)", async () => {
    for (const [path, body] of MUTATIONS) {
      const res = await post(path, body, impersonationCookie());
      expect(res.status, path).toBe(403);
      expect(res.body.impersonating, path).toBe(true);
    }
    // Nothing was written anywhere.
    expect(await db.select().from(universityHabits)).toHaveLength(0);
    expect(await db.select().from(universityJournalEntries)).toHaveLength(0);
    expect(await db.select().from(universityActivities)).toHaveLength(0);
  });

  it("401 without a session on every practice mutation", async () => {
    for (const [path, body] of MUTATIONS) {
      const res = await post(path, body);
      expect(res.status, path).toBe(401);
    }
  });

  it("403 for a logged-in NON-member on mutations and reads", async () => {
    for (const [path, body] of MUTATIONS) {
      const res = await post(path, body, nonMemberCookie());
      expect(res.status, path).toBe(403);
    }
    for (const path of [
      "/university/habits",
      `/university/journal?day=${todayStr}`,
      "/university/activities",
    ]) {
      const res = await get(path, nonMemberCookie());
      expect(res.status, path).toBe(403);
    }
  });

  // --- habits ----------------------------------------------------------------

  it("creates a habit with honest defaults and lists it", async () => {
    const res = await post(
      "/university/habits",
      { name: "Read 10 pages", emoji: "📖" },
      memberCookie(),
    );
    expect(res.status).toBe(200);
    expect(res.body.habit).toMatchObject({
      name: "Read 10 pages",
      emoji: "📖",
      catalogSlug: null,
      timesPerWeek: 7,
      timeOfDay: "any",
      active: true,
    });
    expect(res.body.habit.id).toBeTruthy();

    const list = await get("/university/habits", memberCookie());
    expect(list.status).toBe(200);
    expect(list.body.habits).toHaveLength(1);
    expect(list.body.habits[0].name).toBe("Read 10 pages");
    expect(list.body.completions).toEqual({});
  });

  it("create validation: missing name, bad timesPerWeek, bad timeOfDay → 400", async () => {
    const noName = await post("/university/habits", {}, memberCookie());
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("name required");

    const badTimes = await post(
      "/university/habits",
      { name: "Walk", timesPerWeek: 0 },
      memberCookie(),
    );
    expect(badTimes.status).toBe(400);
    expect(badTimes.body.error).toBe("timesPerWeek must be an integer 1–7");

    const badTod = await post(
      "/university/habits",
      { name: "Walk", timeOfDay: "noon" },
      memberCookie(),
    );
    expect(badTod.status).toBe(400);
    expect(badTod.body.error).toBe(
      "timeOfDay must be one of morning, afternoon, evening, any",
    );
  });

  it("duplicate habit name (case-insensitive) → 400", async () => {
    await createHabit({ name: "Stretch" });
    const dupe = await post(
      "/university/habits",
      { name: "  stretch " },
      memberCookie(),
    );
    expect(dupe.status).toBe(400);
    expect(dupe.body.error).toBe("You already have a habit with this name");
    expect(await db.select().from(universityHabits)).toHaveLength(1);
  });

  it("50-active-habit cap → 400 'Habit limit reached (50)'", async () => {
    await db.insert(universityHabits).values(
      Array.from({ length: 50 }, (_, i) => ({
        accountId: memberAccountId,
        email: MEMBER_EMAIL,
        name: `habit-${i + 1}`,
      })),
    );
    const res = await post(
      "/university/habits",
      { name: "One too many" },
      memberCookie(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Habit limit reached (50)");
  });

  it("update: partial edit works; unknown + other-member habitId → 404", async () => {
    const habit = await createHabit({ name: "Walk" });
    const updated = await post(
      "/university/habits/update",
      { habitId: habit.id, name: "Walk outside", timesPerWeek: 3, active: false },
      memberCookie(),
    );
    expect(updated.status).toBe(200);
    expect(updated.body.habit).toMatchObject({
      id: habit.id,
      name: "Walk outside",
      timesPerWeek: 3,
      active: false,
    });

    const unknown = await post(
      "/university/habits/update",
      { habitId: "00000000-0000-4000-8000-000000000000", name: "X" },
      memberCookie(),
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("Habit not found");

    // Another member's habit is indistinguishable from a missing one.
    const [foreign] = await db
      .insert(universityHabits)
      .values({ email: OTHER_MEMBER_EMAIL, name: "Not yours" })
      .returning();
    const notMine = await post(
      "/university/habits/update",
      { habitId: foreign.id, name: "Hijack" },
      memberCookie(),
    );
    expect(notMine.status).toBe(404);
  });

  it("update: renaming onto another habit's name → 400", async () => {
    await createHabit({ name: "Stretch" });
    const habit = await createHabit({ name: "Walk" });
    const res = await post(
      "/university/habits/update",
      { habitId: habit.id, name: "STRETCH" },
      memberCookie(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("You already have a habit with this name");
  });

  it("toggle: tick + re-tick + untick + re-untick are all clean 200s (idempotent, never 409)", async () => {
    const habit = await createHabit();

    const tick = await post(
      "/university/habits/toggle",
      { habitId: habit.id, done: true },
      memberCookie(),
    );
    expect(tick.status).toBe(200);
    expect(tick.body).toEqual({ habitId: habit.id, day: todayStr, done: true });
    expect(await db.select().from(universityHabitCompletions)).toHaveLength(1);

    const reTick = await post(
      "/university/habits/toggle",
      { habitId: habit.id, done: true },
      memberCookie(),
    );
    expect(reTick.status).toBe(200);
    expect(await db.select().from(universityHabitCompletions)).toHaveLength(1);

    // The tick shows up in the habits completions map.
    const list = await get("/university/habits", memberCookie());
    expect(list.body.completions[habit.id]).toEqual([todayStr]);

    const untick = await post(
      "/university/habits/toggle",
      { habitId: habit.id, done: false },
      memberCookie(),
    );
    expect(untick.status).toBe(200);
    expect(untick.body).toEqual({
      habitId: habit.id,
      day: todayStr,
      done: false,
    });
    expect(await db.select().from(universityHabitCompletions)).toHaveLength(0);

    const reUntick = await post(
      "/university/habits/toggle",
      { habitId: habit.id, done: false },
      memberCookie(),
    );
    expect(reUntick.status).toBe(200);
  });

  it("toggle window: -7 days ok; future and older than 7 days → 400; bad done → 400; unknown habit → 404", async () => {
    const habit = await createHabit();

    const edge = await post(
      "/university/habits/toggle",
      { habitId: habit.id, day: day(-7), done: true },
      memberCookie(),
    );
    expect(edge.status).toBe(200);

    const future = await post(
      "/university/habits/toggle",
      { habitId: habit.id, day: day(1), done: true },
      memberCookie(),
    );
    expect(future.status).toBe(400);
    expect(future.body.error).toBe(
      "day must be today or within the last 7 days",
    );

    const tooOld = await post(
      "/university/habits/toggle",
      { habitId: habit.id, day: day(-8), done: true },
      memberCookie(),
    );
    expect(tooOld.status).toBe(400);

    const badDone = await post(
      "/university/habits/toggle",
      { habitId: habit.id, done: "yes" },
      memberCookie(),
    );
    expect(badDone.status).toBe(400);
    expect(badDone.body.error).toBe("done must be a boolean");

    const unknown = await post(
      "/university/habits/toggle",
      { habitId: "00000000-0000-4000-8000-000000000000", done: true },
      memberCookie(),
    );
    expect(unknown.status).toBe(404);
  });

  // --- journal ---------------------------------------------------------------

  it("GET journal returns the empty shell for an unwritten day", async () => {
    const res = await get(
      `/university/journal?day=${todayStr}`,
      memberCookie(),
    );
    expect(res.status).toBe(200);
    expect(res.body.entry).toEqual({
      day: todayStr,
      mit: "",
      mitDone: null,
      gratitude: [],
      wins: [],
      notes: "",
      updatedAt: null,
    });

    const badDay = await get("/university/journal?day=nope", memberCookie());
    expect(badDay.status).toBe(400);
  });

  it("journal PARTIAL merge: a second POST with only { notes } keeps mit + gratitude", async () => {
    const first = await post(
      "/university/journal",
      { day: todayStr, mit: "Ship the PR", gratitude: ["health", "coffee"] },
      memberCookie(),
    );
    expect(first.status).toBe(200);
    expect(first.body.entry.mit).toBe("Ship the PR");
    expect(first.body.entry.gratitude).toEqual(["health", "coffee"]);

    const second = await post(
      "/university/journal",
      { day: todayStr, notes: "Wound down early." },
      memberCookie(),
    );
    expect(second.status).toBe(200);
    expect(second.body.entry.mit).toBe("Ship the PR");
    expect(second.body.entry.gratitude).toEqual(["health", "coffee"]);
    expect(second.body.entry.notes).toBe("Wound down early.");
    expect(second.body.entry.updatedAt).toBeTruthy();

    // Still exactly one row (upsert, not append).
    expect(await db.select().from(universityJournalEntries)).toHaveLength(1);

    const readBack = await get(
      `/university/journal?day=${todayStr}`,
      memberCookie(),
    );
    expect(readBack.body.entry.mit).toBe("Ship the PR");
    expect(readBack.body.entry.notes).toBe("Wound down early.");
  });

  it("journal validation 400s: bad day, window, mit length, list shape", async () => {
    const noDay = await post("/university/journal", {}, memberCookie());
    expect(noDay.status).toBe(400);
    expect(noDay.body.error).toBe("day must be YYYY-MM-DD");

    const future = await post(
      "/university/journal",
      { day: day(1), mit: "x" },
      memberCookie(),
    );
    expect(future.status).toBe(400);
    expect(future.body.error).toBe(
      "day must be today or within the last 30 days",
    );

    const tooOld = await post(
      "/university/journal",
      { day: day(-31), mit: "x" },
      memberCookie(),
    );
    expect(tooOld.status).toBe(400);

    const edge = await post(
      "/university/journal",
      { day: day(-30), mit: "x" },
      memberCookie(),
    );
    expect(edge.status).toBe(200);

    const longMit = await post(
      "/university/journal",
      { day: todayStr, mit: "x".repeat(281) },
      memberCookie(),
    );
    expect(longMit.status).toBe(400);
    expect(longMit.body.error).toBe("mit must be at most 280 characters");

    const fourGratitude = await post(
      "/university/journal",
      { day: todayStr, gratitude: ["a", "b", "c", "d"] },
      memberCookie(),
    );
    expect(fourGratitude.status).toBe(400);
    expect(fourGratitude.body.error).toBe(
      "gratitude must have at most 3 items",
    );

    const nonStringWin = await post(
      "/university/journal",
      { day: todayStr, wins: [42] },
      memberCookie(),
    );
    expect(nonStringWin.status).toBe(400);
    expect(nonStringWin.body.error).toBe("wins must be an array of strings");

    const longNotes = await post(
      "/university/journal",
      { day: todayStr, notes: "x".repeat(4001) },
      memberCookie(),
    );
    expect(longNotes.status).toBe(400);
  });

  // --- activities ------------------------------------------------------------

  it("records an aggregate activity and lists newest first", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 2 * 86_400_000);

    const first = await post(
      "/university/activities",
      {
        activityType: "walk",
        startedAt: earlier.toISOString(),
        durationS: 1200,
        distanceM: 2000,
      },
      memberCookie(),
    );
    expect(first.status).toBe(200);

    const second = await post(
      "/university/activities",
      {
        activityType: "run",
        startedAt: now.toISOString(),
        durationS: 1800,
        distanceM: 5000,
      },
      memberCookie(),
    );
    expect(second.status).toBe(200);
    expect(second.body.activity).toMatchObject({
      activityType: "run",
      durationS: 1800,
      distanceM: 5000,
    });
    expect(second.body.activity.startedAt).toBe(now.toISOString());

    const list = await get("/university/activities", memberCookie());
    expect(list.status).toBe(200);
    expect(list.body.activities).toHaveLength(2);
    // Newest (the run) first.
    expect(list.body.activities[0].activityType).toBe("run");
    expect(list.body.activities[1].activityType).toBe("walk");
  });

  it("activity validation 400s: type allowlist, startedAt window, integer ranges", async () => {
    const base = {
      activityType: "run",
      startedAt: new Date().toISOString(),
      durationS: 60,
      distanceM: 100,
    };

    const badType = await post(
      "/university/activities",
      { ...base, activityType: "swim" },
      memberCookie(),
    );
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe(
      "activityType must be one of run, walk, hike, bike, other",
    );

    const badIso = await post(
      "/university/activities",
      { ...base, startedAt: "not-a-date" },
      memberCookie(),
    );
    expect(badIso.status).toBe(400);
    expect(badIso.body.error).toBe("startedAt must be an ISO timestamp");

    const tooOld = await post(
      "/university/activities",
      {
        ...base,
        startedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      },
      memberCookie(),
    );
    expect(tooOld.status).toBe(400);
    expect(tooOld.body.error).toBe("startedAt must be within the last 7 days");

    const tooFuture = await post(
      "/university/activities",
      {
        ...base,
        startedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      memberCookie(),
    );
    expect(tooFuture.status).toBe(400);

    const zeroDuration = await post(
      "/university/activities",
      { ...base, durationS: 0 },
      memberCookie(),
    );
    expect(zeroDuration.status).toBe(400);
    expect(zeroDuration.body.error).toBe(
      "durationS must be an integer 1–86400",
    );

    const negativeDistance = await post(
      "/university/activities",
      { ...base, distanceM: -1 },
      memberCookie(),
    );
    expect(negativeDistance.status).toBe(400);
    expect(negativeDistance.body.error).toBe(
      "distanceM must be an integer 0–500000",
    );

    expect(await db.select().from(universityActivities)).toHaveLength(0);
  });
});
