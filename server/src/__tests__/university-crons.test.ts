// ---------------------------------------------------------------------------
// Coherent Ones University — lifecycle cron tests (streak nudge + dunning).
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
// Dunning:
//   - d3 fires university_past_due touch=2, no final warning
//   - d7 fires university_past_due touch=3 AND university_payment_failed_final
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the email callback BEFORE importing the crons (which import it).
const emailSpy = vi.fn(async () => undefined);
vi.mock("../services/creditscore-email-callback.js", () => ({
  sendCreditscoreEmail: (...args: unknown[]) => emailSpy(...args),
}));

import {
  runUniversityStreakNudge,
  runUniversityDunningD3,
  runUniversityDunningD7,
} from "../services/university-crons.js";

// ---------------------------------------------------------------------------
// Query-queue db stub. Each select().from().where() consumes one queued result.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeDb(queue: Row[][]) {
  let i = 0;
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
  return {
    db: { select: () => selectChain() } as unknown as Parameters<
      typeof runUniversityStreakNudge
    >[0],
    get consumed() {
      return i;
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
});

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------

describe("runUniversityDunningD3", () => {
  it("fires past_due touch=2 and NO final warning", async () => {
    const subs: Row[] = [{ id: "sub-1", email: "due@x.test" }];
    const { db } = makeDb([subs]);

    const sent = await runUniversityDunningD3(db);

    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0][0] as {
      kind: string;
      data: { touch: number };
    };
    expect(call.kind).toBe("university_past_due");
    expect(call.data.touch).toBe(2);
  });

  it("skips subscription rows with no email", async () => {
    const subs: Row[] = [{ id: "sub-1", email: null }];
    const { db } = makeDb([subs]);
    const sent = await runUniversityDunningD3(db);
    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
  });
});

describe("runUniversityDunningD7", () => {
  it("fires past_due touch=3 AND the final payment-failed warning", async () => {
    const subs: Row[] = [{ id: "sub-1", email: "lapsing@x.test" }];
    const { db } = makeDb([subs]);

    const sent = await runUniversityDunningD7(db);

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
  });
});
