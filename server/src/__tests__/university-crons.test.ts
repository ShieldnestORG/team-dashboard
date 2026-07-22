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
  runUniversityDunningD3,
  runUniversityDunningD7,
} from "../services/university-crons.js";

// ---------------------------------------------------------------------------
// Query-queue db stub. Each select().from().where() consumes one queued result.
// insert().values(row) is a no-op that records the row (email-log writes) — it
// does NOT consume the select queue.
//
// A queue slot may instead be an INSERTS sentinel `{ __insertsKind }`: the
// stubbed query then returns the rows ACTUALLY recorded by insert().values()
// so far, filtered to that kind — faithfully replicating the email-log dedup
// query's `WHERE kind = <marker>` against the real logged rows. This lets the
// dunning dedup path be exercised end-to-end (a second run reads the first
// run's logged marker) instead of being handed a hand-faked result.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type InsertsSentinel = { __insertsKind: string };
type QueueSlot = Row[] | InsertsSentinel;

function isInsertsSentinel(slot: QueueSlot | undefined): slot is InsertsSentinel {
  return !!slot && !Array.isArray(slot) && "__insertsKind" in slot;
}

function makeDb(queue: QueueSlot[]) {
  let i = 0;
  const inserts: Row[] = [];
  function selectChain() {
    const chain = {
      from() {
        return chain;
      },
      where() {
        const slot = queue[i];
        i += 1;
        if (isInsertsSentinel(slot)) {
          const kind = slot.__insertsKind;
          return Promise.resolve(inserts.filter((r) => r.kind === kind));
        }
        return Promise.resolve(slot ?? []);
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
    // Query order: progress, check-ins ([] — none), active members.
    const { db } = makeDb([progressRows, [], memberRows]);

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
    // Slot 1 is the check-ins scan ([] — none). With an empty at-risk set we
    // short-circuit before the members query.
    const { db } = makeDb([progressRows, []]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("EXCLUDES a member who checked in today (union streak — no false at-risk nudge)", async () => {
    // Repped yesterday (streak alive), NO rep today — but DID a stand-alone
    // check-in today. The union streak counts the check-in as today's signal, so
    // the member is NOT at risk and must never be nudged. Without the union this
    // member would be a false positive (repped yesterday, not today) and get a
    // "your streak is at risk" email while their streak is actually safe.
    const progressRows: Row[] = [
      { email: "checkedin@x.test", repDay: YESTERDAY },
    ];
    const checkinRows: Row[] = [
      { email: "checkedin@x.test", checkinDay: TODAY },
    ];
    // Query order: progress, check-ins (has TODAY → member is safe).
    const { db } = makeDb([progressRows, checkinRows]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("skips a member whose latest rep is older than yesterday (chain already broken)", async () => {
    const progressRows: Row[] = [
      { email: "stale@x.test", repDay: TWO_DAYS_AGO },
    ];
    // Slot 1 is the check-ins scan ([] — none).
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
    // Query order: progress, check-ins ([] — none), active members ([]).
    const { db } = makeDb([progressRows, [], memberRows]);

    const sent = await runUniversityStreakNudge(db, NOW);

    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("returns 0 and issues no member query when no one has a day-signal yesterday", async () => {
    const harness = makeDb([[], []]);
    const sent = await runUniversityStreakNudge(harness.db, NOW);
    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
    // Only the progress + check-ins scans ran (short-circuit before the member
    // query, since the at-risk set is empty).
    expect(harness.consumed).toBe(2);
  });

  it("skips a member already nudged within the last 7 days (weekly cap)", async () => {
    const progressRows: Row[] = [{ email: "capped@x.test", repDay: YESTERDAY }];
    const memberRows: Row[] = [
      { email: "capped@x.test", displayName: "Grace Hopper" },
    ];
    // The email-log query (kind=university_streak_nudge, sent_at > now-7d)
    // returns a recent row for this member → capped.
    const logRows: Row[] = [{ email: "capped@x.test" }];
    // Query order: progress, check-ins ([]), active members, email-log.
    const { db } = makeDb([progressRows, [], memberRows, logRows]);

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
    // Query order: progress, check-ins ([]), active members, email-log.
    const harness = makeDb([progressRows, [], memberRows, []]);

    const sent = await runUniversityStreakNudge(harness.db, NOW);

    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    // A log row is written, lowercased, with the nudge kind. messageId is null
    // here because the mocked send returns no storefront response id.
    expect(harness.inserts).toEqual([
      { email: "due@x.test", kind: "university_streak_nudge", messageId: null },
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
      {
        email: "logme@x.test",
        kind: "university_reengage_d14",
        messageId: null,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Dunning — day-3 (touch=2) / day-7 (touch=3 + final payment-failed warning).
//   - d3 fires university_past_due touch=2 and NO final warning
//   - d7 fires university_past_due touch=3 AND university_payment_failed_final
//
// Query order per run: (1) past_due subscription select, (2) email-log dedup
// select (per-touch marker kind, 30-day horizon). Selection is a threshold
// (updated_at <= now - dayMark days) enforced SQL-side; the stub is handed the
// already-filtered subscription result. Per-touch idempotency comes from the
// email-log dedup, exercised below via the INSERTS sentinel (real logged rows).
// ---------------------------------------------------------------------------

describe("runUniversityDunningD3", () => {
  it("fires past_due touch=2, NO final warning, and logs the d3 marker", async () => {
    const subs: Row[] = [{ id: "sub-1", email: "due@x.test" }];
    const harness = makeDb([subs, []]);

    const sent = await runUniversityDunningD3(harness.db);

    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0][0] as {
      kind: string;
      data: { touch: number };
    };
    expect(call.kind).toBe("university_past_due");
    expect(call.data.touch).toBe(2);
    // The final warning must NOT fire on d3.
    const kinds = emailSpy.mock.calls.map(
      (c) => (c[0] as { kind: string }).kind,
    );
    expect(kinds).not.toContain("university_payment_failed_final");
    // The per-touch dedup marker is logged (lowercased, messageId null from the
    // mocked send). This is what makes a second run dedup.
    expect(harness.inserts).toEqual([
      { email: "due@x.test", kind: "university_past_due_d3", messageId: null },
    ]);
  });

  it("excludes a non-past_due subscription (status='past_due' filter is SQL-side)", async () => {
    // The runner's WHERE pins status='past_due', so a non-past_due row never
    // comes back from the subscription query; we model that filtered result as
    // empty and assert nothing is sent.
    const { db } = makeDb([[]]);
    const sent = await runUniversityDunningD3(db);
    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("skips subscription rows with no email", async () => {
    const subs: Row[] = [{ id: "sub-1", email: null }];
    const { db } = makeDb([subs]);
    const sent = await runUniversityDunningD3(db);
    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("does NOT re-send on a second run — email-log dedup filters the prior send", async () => {
    const subs: Row[] = [{ id: "sub-1", email: "due@x.test" }];
    // ONE db across both runs. Run 1: subs, then dedup query (no prior log → []).
    // Run 2: subs, then the dedup query reads the ACTUAL logged marker rows via
    // the INSERTS sentinel (filtered to the d3 marker), exercising the real
    // dedup query path rather than a hand-faked result.
    const harness = makeDb([
      subs,
      [],
      subs,
      { __insertsKind: "university_past_due_d3" },
    ]);

    const first = await runUniversityDunningD3(harness.db);
    expect(first).toBe(1);
    expect(harness.inserts).toEqual([
      { email: "due@x.test", kind: "university_past_due_d3", messageId: null },
    ]);

    emailSpy.mockClear();
    const second = await runUniversityDunningD3(harness.db);
    expect(second).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });
});

describe("runUniversityDunningD7", () => {
  it("fires past_due touch=3 AND the final payment-failed warning", async () => {
    const subs: Row[] = [{ id: "sub-1", email: "lapsing@x.test" }];
    const harness = makeDb([subs, []]);

    const sent = await runUniversityDunningD7(harness.db);

    expect(sent).toBe(1); // count tracks past_due nudges
    expect(emailSpy).toHaveBeenCalledTimes(2);
    const kinds = emailSpy.mock.calls.map(
      (c) => (c[0] as { kind: string }).kind,
    );
    expect(kinds).toContain("university_past_due");
    expect(kinds).toContain("university_payment_failed_final");
    const pastDue = emailSpy.mock.calls
      .map((c) => c[0] as { kind: string; data: { touch?: number } })
      .find((p) => p.kind === "university_past_due");
    expect(pastDue?.data.touch).toBe(3);
    // Both sends are logged: the d7 marker (dedup key) + the final-warning kind
    // (so its own opens/clicks join). messageId null from the mocked send.
    expect(harness.inserts).toEqual([
      {
        email: "lapsing@x.test",
        kind: "university_past_due_d7",
        messageId: null,
      },
      {
        email: "lapsing@x.test",
        kind: "university_payment_failed_final",
        messageId: null,
      },
    ]);
  });
});

// d3-then-d7 ladder across two runs on ONE db: the d3 send must not block d7,
// because the two touches dedup on DISTINCT marker kinds.
describe("dunning ladder (d3 then d7)", () => {
  it("fires d3 (touch=2) then d7 (touch=3 + final); the d3 marker does not block d7", async () => {
    const subs: Row[] = [{ id: "sub-1", email: "ladder@x.test" }];
    // d3 run: subs, dedup(d3 marker) reads inserts → none yet → sends + logs d3.
    // d7 run: subs, dedup(d7 marker) reads inserts → only a d3 marker exists →
    // filtered to the d7 marker it's empty → d7 still fires.
    const harness = makeDb([
      subs,
      { __insertsKind: "university_past_due_d3" },
      subs,
      { __insertsKind: "university_past_due_d7" },
    ]);

    const d3 = await runUniversityDunningD3(harness.db);
    expect(d3).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(
      (emailSpy.mock.calls[0][0] as { data: { touch: number } }).data.touch,
    ).toBe(2);

    emailSpy.mockClear();
    const d7 = await runUniversityDunningD7(harness.db);
    expect(d7).toBe(1);
    const kinds = emailSpy.mock.calls.map(
      (c) => (c[0] as { kind: string }).kind,
    );
    expect(kinds).toContain("university_past_due");
    expect(kinds).toContain("university_payment_failed_final");
    const pastDue = emailSpy.mock.calls
      .map((c) => c[0] as { kind: string; data: { touch?: number } })
      .find((p) => p.kind === "university_past_due");
    expect(pastDue?.data.touch).toBe(3);
  });
});
