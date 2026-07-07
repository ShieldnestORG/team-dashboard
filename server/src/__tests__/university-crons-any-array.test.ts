// ---------------------------------------------------------------------------
// Regression test for the University lifecycle crons' email-log DEDUP query, run
// against a REAL (embedded) Postgres + the postgres.js driver.
//
// THE BUG (fixed on fix/university-any-array-binding): the reengage / streak /
// dunning crons deduped against university_email_log with an ANY() over a JS
// array, written as
//     ... WHERE LOWER(email) = ANY(${emails})
// where `emails` is a JS string[]. drizzle expands an interpolated JS array into
// a parenthesised row, so against the real postgres.js driver this compiles to
//     ... = ANY(($1, $2))
// and Postgres throws `PostgresError: malformed array literal` for ANY
// non-empty, multi-element batch — i.e. on the happy path, every time >=2
// members were eligible in the same sweep. The fix rebuilds the array element-
// by-element as a real text[] literal:
//     ANY(ARRAY[${sql.join(emails.map((e) => sql`${e}`), sql`, `)}]::text[])
// which binds each email as its own scalar param — the form Postgres accepts.
//
// WHY THE EXISTING SUITE MISSED IT: university-crons.test.ts drives the runners
// with a hand-rolled query-queue stub whose .where() just returns a canned
// result — it never compiles or binds the SQL, so the array-binding error, which
// only the real driver raises, could never surface. This test closes that gap:
// it seeds enough real rows that runUniversityReengage reaches the dedup query
// with a NON-EMPTY, multi-element (>=2) `emails` array against real Postgres and
// asserts the tick completes with no `malformed array literal` driver error.
// Run against the buggy ANY(${emails}) form it fails there.
//
// Like every embedded-Postgres test in this repo, it self-skips on hosts whose
// embedded Postgres lacks the pgvector extension (the full migration chain needs
// vector(1024) columns); it runs in CI where pgvector is present.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDb,
  universityMembers,
  universityProgress,
  universityEmailLog,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

// Mock the email callback BEFORE importing the cron (which imports it) so the
// tick stays offline and deterministic. Only the DATABASE is real here — that is
// the whole point, since only a real driver raises the array-binding error. The
// mock returns a messageId, exercising the logUniversityEmail write path too.
const emailSpy = vi.fn(async () => "msg-test-1" as string | null);
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: (...args: unknown[]) => emailSpy(...args),
}));

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;
if (!support.supported) {
  console.warn(
    `Skipping university-crons ANY-array test on this host: ${support.reason ?? "embedded Postgres unsupported"}`,
  );
}

let runUniversityReengage: typeof import("../services/university-crons.js").runUniversityReengage;

// Fixed "now" so the UTC-day bucket math is deterministic. 2026-06-19 (UTC).
const NOW = new Date("2026-06-19T12:00:00.000Z");
// Last-activity days that land EXACTLY on reengage buckets relative to NOW.
const DAY7 = "2026-06-12"; // quiet exactly 7 days  → university_reengage_d7
const DAY14 = "2026-06-05"; // quiet exactly 14 days → university_reengage_d14

describeDb("university-crons reengage dedup ANY() array (real Postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-university-any-");
    db = createDb(tempDb.connectionString);
    ({ runUniversityReengage } = await import("../services/university-crons.js"));
  }, 60_000);

  afterEach(async () => {
    await db.delete(universityEmailLog);
    await db.delete(universityProgress);
    await db.delete(universityMembers);
    emailSpy.mockClear();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // Seed one ACTIVE member whose last rep-day lands exactly on `repDay` (a
  // reengage bucket). Two such members with distinct emails give the dedup query
  // a multi-element `emails` array — the >=2 case that broke pre-fix.
  async function seedActiveMemberAtBucket(email: string, repDay: string): Promise<void> {
    await db.insert(universityMembers).values({
      id: randomUUID(),
      email,
      displayName: "Ada Lovelace",
      status: "active",
    });
    await db.insert(universityProgress).values({
      id: randomUUID(),
      email,
      lessonSlug: "presence/the-leak",
      repDay,
    });
  }

  it("reaches the email-log dedup with a >=2-element array and does not throw 'malformed array literal'", async () => {
    // Two eligible active members → eligible.emails = [a, b] (length 2), so the
    // dedup query compiles to `LOWER(email) = ANY(ARRAY[$1, $2]::text[])`. This
    // is the exact >=2-element array that the buggy `ANY(${emails})` form threw
    // `malformed array literal` on, before any email could be sent.
    await seedActiveMemberAtBucket("d7@x.test", DAY7);
    await seedActiveMemberAtBucket("d14@x.test", DAY14);

    // Pre-fix, this call REJECTED inside the dedup query with `malformed array
    // literal` — so it resolving at all is the regression signal.
    const sent = await runUniversityReengage(db, NOW);

    // The empty email-log means neither member is deduped: both get sent.
    expect(sent).toBe(2);
    expect(emailSpy).toHaveBeenCalledTimes(2);
    const kindsByEmail = new Map(
      emailSpy.mock.calls.map((c) => {
        const a = c[0] as { kind: string; to: string };
        return [a.to, a.kind];
      }),
    );
    expect(kindsByEmail.get("d7@x.test")).toBe("university_reengage_d7");
    expect(kindsByEmail.get("d14@x.test")).toBe("university_reengage_d14");

    // Each send wrote a lowercased dedup row to university_email_log — the rows
    // the ANY() dedup reads on the next sweep.
    const logRows = await db
      .select({ email: universityEmailLog.email, kind: universityEmailLog.kind })
      .from(universityEmailLog);
    expect(logRows).toHaveLength(2);
    expect(new Set(logRows.map((r) => `${r.email}|${r.kind}`))).toEqual(
      new Set([
        "d7@x.test|university_reengage_d7",
        "d14@x.test|university_reengage_d14",
      ]),
    );
  });

  it("on a re-run the >=2-element ANY() dedup filters both prior sends (no re-send, no driver error)", async () => {
    // A second sweep now READS the two logged rows through the same
    // `= ANY(ARRAY[$1, $2]::text[])` dedup query — exercising the array binding
    // on the READ side against real rows, not a hand-faked result. Both members
    // are deduped, so nothing re-sends and, crucially, the query does not throw.
    await seedActiveMemberAtBucket("d7@x.test", DAY7);
    await seedActiveMemberAtBucket("d14@x.test", DAY14);

    const first = await runUniversityReengage(db, NOW);
    expect(first).toBe(2);

    emailSpy.mockClear();
    const second = await runUniversityReengage(db, NOW);
    expect(second).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });
});
