// ---------------------------------------------------------------------------
// Coherent Ones University — lifecycle cron tests (streak nudge).
//
// No embedded Postgres: the cron runners take a Db and call sequential
// select().from().where() chains, so we drive them with a tiny query-queue stub
// (mirrors the makeDb pattern in university-stripe-handler.test.ts). The email
// callback is mocked and spied so we can assert exactly which kinds fired with
// which data.
//
// Streak-nudge math (the at-risk detection + streak length) is the load-bearing
// logic — it's code-graded (Rule 5), so these assertions pin it precisely:
//   - repped yesterday, not today, ACTIVE  → nudged, correct streakDays
//   - repped today                         → skipped (chain already safe)
//   - latest rep older than yesterday      → skipped (chain already broken)
//   - at-risk but NOT an active member      → skipped (membership gate)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the email callback BEFORE importing the crons (which import it).
const emailSpy = vi.fn(async () => undefined);
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: (...args: unknown[]) => emailSpy(...args),
}));

import {
  runUniversityStreakNudge,
  runUniversityReengage,
} from "../services/university-crons.js";

// ---------------------------------------------------------------------------
// Query-queue db stub. Each select().from().where() consumes one queued result.
// insert().values(row) is a no-op that records the row (email-log writes) — it
// does NOT consume the select queue.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeDb(queue: Row[][]) {
  let i = 0;
  const inserts: Row[] = [];
  function selectChain() {
    const chain = {
      from() {
        return chain;
      },
      where() {
        const result = queue[i] ?? [];
        i += 1;
        return Promise.resolve(result);
      },
    };
    return chain;
  }
  function insertChain() {
    return {
      values(row: Row) {
        inserts.push(row);
        return Promise.resolve(undefined);
      },
    };
  }
  return {
    db: {
      select: () => selectChain(),
      insert: () => insertChain(),
    } as unknown as Parameters<typeof runUniversityStreakNudge>[0],
    get consumed() {
      return i;
    },
    get inserts() {
      return inserts;
    },
  };
}

beforeEach(() => {
  emailSpy.mockClear();
});

// Fixed "now" so rep-day math is deterministic. 2026-06-19 (UTC).
const NOW = new Date("2026-06-19T12:00:00.000Z");
const TODAY = "2026-06-19";
const YESTERDAY = "2026-06-18";
const TWO_DAYS_AGO = "2026-06-17";

// ---------------------------------------------------------------------------
// Streak nudge
// ---------------------------------------------------------------------------

describe("runUniversityStreakNudge", () => {
  it("nudges an active member who repped yesterday but not today, with the right streak length", async () => {
    const progressRows: Row[] = [
      // 2-day live streak ending yesterday: 17th, 18th.
      { email: "live@x.test", repDay: TWO_DAYS_AGO },
      { email: "live@x.test", repDay: YESTERDAY },
    ];
    const memberRows: Row[] = [
      { email: "live@x.test", displayName: "Ada Lovelace" },
    ];
    const { db } = makeDb([progressRows, memberRows]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0][0] as {
      kind: string;
      to: string;
      data: { firstName?: string; streakDays: number; repUrl: string };
    };
    expect(call.kind).toBe("university_streak_nudge");
    expect(call.to).toBe("live@x.test");
    expect(call.data.streakDays).toBe(2); // 17th + 18th
    expect(call.data.firstName).toBe("Ada");
    expect(typeof call.data.repUrl).toBe("string");
  });

  it("skips a member who already repped today (chain not at risk)", async () => {
    const progressRows: Row[] = [
      { email: "today@x.test", repDay: YESTERDAY },
      { email: "today@x.test", repDay: TODAY },
    ];
    // members query should still be issued but with an empty at-risk set we
    // short-circuit before it; provide [] defensively.
    const { db } = makeDb([progressRows, []]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("skips a member whose latest rep is older than yesterday (chain already broken)", async () => {
    const progressRows: Row[] = [
      { email: "stale@x.test", repDay: TWO_DAYS_AGO },
    ];
    const { db } = makeDb([progressRows, []]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("skips an at-risk member who is NOT active (membership gate)", async () => {
    const progressRows: Row[] = [
      { email: "churned@x.test", repDay: YESTERDAY },
    ];
    // active-members query returns no row for this email → gated out.
    const memberRows: Row[] = [];
    const { db } = makeDb([progressRows, memberRows]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("returns 0 and issues no member query when no one repped yesterday", async () => {
    const harness = makeDb([[]]);
    const sent = await runUniversityStreakNudge(harness.db, NOW);
    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
    // Only the progress query ran (short-circuit before the member query).
    expect(harness.consumed).toBe(1);
  });

  it("skips a member already nudged within the last 7 days (weekly cap)", async () => {
    const progressRows: Row[] = [{ email: "capped@x.test", repDay: YESTERDAY }];
    const memberRows: Row[] = [
      { email: "capped@x.test", displayName: "Grace Hopper" },
    ];
    // The email-log query (kind=university_streak_nudge, sent_at > now-7d)
    // returns a recent row for this member → capped.
    const logRows: Row[] = [{ email: "capped@x.test" }];
    const { db } = makeDb([progressRows, memberRows, logRows]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("sends and writes a log row when the last nudge was over 7 days ago", async () => {
    const progressRows: Row[] = [{ email: "Due@x.test", repDay: YESTERDAY }];
    const memberRows: Row[] = [
      { email: "Due@x.test", displayName: "Katherine Johnson" },
    ];
    // The 7-day cap query returns nothing (the >7d-old row is filtered out by
    // the sent_at cutoff in SQL) → not capped.
    const harness = makeDb([progressRows, memberRows, []]);

    const sent = await runUniversityStreakNudge(harness.db, NOW);

    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    // A log row is written, lowercased, with the nudge kind.
    expect(harness.inserts).toEqual([
      { email: "due@x.test", kind: "university_streak_nudge" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Re-engagement check-in. Query order: (1) active members, (2) 30-day progress
// scan, (3) email-log dedup. Buckets relative to NOW=2026-06-19.
// ---------------------------------------------------------------------------

const DAY7 = "2026-06-12";
const DAY14 = "2026-06-05";
const DAY30 = "2026-05-20";
const DAY8 = "2026-06-11"; // 8 days quiet — between buckets

describe("runUniversityReengage", () => {
  it("sends the matching kind to members quiet exactly 7 / 14 / 30 days", async () => {
    const memberRows: Row[] = [
      { email: "d7@x.test", displayName: "Ada Lovelace", joinedAt: null },
      { email: "d14@x.test", displayName: "Grace Hopper", joinedAt: null },
      { email: "d30@x.test", displayName: "Radia Perlman", joinedAt: null },
    ];
    const progressRows: Row[] = [
      { email: "d7@x.test", repDay: DAY7 },
      { email: "d14@x.test", repDay: DAY14 },
      { email: "d30@x.test", repDay: DAY30 },
    ];
    const { db } = makeDb([memberRows, progressRows, []]);

    const sent = await runUniversityReengage(db, NOW);

    expect(sent).toBe(3);
    expect(emailSpy).toHaveBeenCalledTimes(3);
    const byEmail = new Map(
      emailSpy.mock.calls.map((c) => {
        const a = c[0] as {
          kind: string;
          to: string;
          data: { firstName?: string; daysAway: number };
        };
        return [a.to, a];
      }),
    );
    expect(byEmail.get("d7@x.test")?.kind).toBe("university_reengage_d7");
    expect(byEmail.get("d7@x.test")?.data.daysAway).toBe(7);
    expect(byEmail.get("d7@x.test")?.data.firstName).toBe("Ada");
    expect(byEmail.get("d14@x.test")?.kind).toBe("university_reengage_d14");
    expect(byEmail.get("d14@x.test")?.data.daysAway).toBe(14);
    expect(byEmail.get("d30@x.test")?.kind).toBe("university_reengage_d30");
    expect(byEmail.get("d30@x.test")?.data.daysAway).toBe(30);
  });

  it("does not send to a member quiet 8 days (no bucket match)", async () => {
    const memberRows: Row[] = [
      { email: "between@x.test", displayName: "Hedy", joinedAt: null },
    ];
    const progressRows: Row[] = [{ email: "between@x.test", repDay: DAY8 }];
    const { db } = makeDb([memberRows, progressRows]);

    const sent = await runUniversityReengage(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("falls back to joined_at for a member with no progress rows", async () => {
    const memberRows: Row[] = [
      {
        email: "fresh@x.test",
        displayName: "Joan Clarke",
        joinedAt: new Date(`${DAY7}T09:00:00.000Z`),
      },
    ];
    // No progress rows at all → last activity = join date (DAY7) → d7.
    const { db } = makeDb([memberRows, [], []]);

    const sent = await runUniversityReengage(db, NOW);

    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0][0] as { kind: string; to: string };
    expect(call.kind).toBe("university_reengage_d7");
    expect(call.to).toBe("fresh@x.test");
  });

  it("skips a member already sent that kind within 30 days (dedup)", async () => {
    const memberRows: Row[] = [
      { email: "dupe@x.test", displayName: "Barbara", joinedAt: null },
    ];
    const progressRows: Row[] = [{ email: "dupe@x.test", repDay: DAY7 }];
    // Dedup query returns a prior d7 send for this email.
    const logRows: Row[] = [
      { email: "dupe@x.test", kind: "university_reengage_d7" },
    ];
    const { db } = makeDb([memberRows, progressRows, logRows]);

    const sent = await runUniversityReengage(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("considers only active members (cancelled excluded from the active query)", async () => {
    // The members query filters status='active' in SQL, so a cancelled member
    // never appears here. We seed one active member NOT in a bucket, and a
    // progress row for a would-be-eligible cancelled member; neither triggers a
    // send — proving the cron keys off the active-member list.
    const memberRows: Row[] = [
      { email: "active@x.test", displayName: "Sophie", joinedAt: NOW },
    ];
    const progressRows: Row[] = [{ email: "cancelled@x.test", repDay: DAY7 }];
    const { db } = makeDb([memberRows, progressRows]);

    const sent = await runUniversityReengage(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("writes a log row on each send", async () => {
    const memberRows: Row[] = [
      { email: "Logme@x.test", displayName: "Annie", joinedAt: null },
    ];
    const progressRows: Row[] = [{ email: "Logme@x.test", repDay: DAY14 }];
    const harness = makeDb([memberRows, progressRows, []]);

    const sent = await runUniversityReengage(harness.db, NOW);

    expect(sent).toBe(1);
    expect(harness.inserts).toEqual([
      { email: "logme@x.test", kind: "university_reengage_d14" },
    ]);
  });
});
