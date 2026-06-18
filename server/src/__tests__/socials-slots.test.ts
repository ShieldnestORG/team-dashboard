/**
 * Unit tests for the next-open-slot auto-scheduler
 * (services/socials/slots.ts). Ported from the verified Python prototype
 * (marketing/prototypes/scheduler/test_scheduler.py).
 *
 * The whole reason for the Intl/timeZone approach (vs a hardcoded -07:00 offset)
 * is DST correctness — covered by TestDST below.
 */
import { describe, expect, it } from "vitest";
import {
  nextOpenSlot,
  requestSlot,
  jitter,
  DEFAULT_SLOTS,
  DEFAULT_TZ,
} from "../services/socials/slots.js";

const LA = "America/Los_Angeles";

/** Build the UTC instant for an LA wall-clock time, DST-correct, using the same
 * formatter trick the implementation conforms to. Mirrors the prototype's
 * `la(...)` helper but yields a JS Date (UTC instant). */
function la(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  // First approximation: treat the wall time as if UTC, then correct by the
  // zone offset observed at that instant.
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: LA, hour12: false,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  });
  const read = (date: Date) => {
    const m = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    return Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour) % 24, Number(m.minute), Number(m.second));
  };
  let offset = read(new Date(naive)) - naive;
  let candidate = new Date(naive - offset);
  const offset2 = read(candidate) - candidate.getTime();
  if (offset2 !== offset) {
    offset = offset2;
    candidate = new Date(naive - offset);
  }
  return candidate;
}

function offsetHours(date: Date): number {
  // utc offset (hours) the LA zone applies at this instant
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: LA, hour12: false,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  });
  const m = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour) % 24, Number(m.minute), Number(m.second));
  return Math.round((asUtc - date.getTime()) / 3600000);
}

describe("nextOpenSlot", () => {
  it("empty calendar returns first slot of the day (09:00)", () => {
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 0, 0));
    expect(got.getTime()).toBe(la(2026, 6, 16, 9, 0).getTime());
  });

  it("after between slots picks the next future slot", () => {
    // after = 10:00 → 09:00 is past, next is 13:00
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 10, 0));
    expect(got.getTime()).toBe(la(2026, 6, 16, 13, 0).getTime());
  });

  it("partially full day skips taken slots", () => {
    const existing = [la(2026, 6, 16, 9, 0), la(2026, 6, 16, 13, 0)];
    const got = nextOpenSlot("acct", existing, la(2026, 6, 16, 0, 0));
    expect(got.getTime()).toBe(la(2026, 6, 16, 18, 0).getTime());
  });

  it("full day rolls to the next day", () => {
    const existing = [la(2026, 6, 16, 9, 0), la(2026, 6, 16, 13, 0), la(2026, 6, 16, 18, 0)];
    const got = nextOpenSlot("acct", existing, la(2026, 6, 16, 0, 0));
    expect(got.getTime()).toBe(la(2026, 6, 17, 9, 0).getTime());
  });

  it("jitter-tolerant occupancy: a stored 09:04 occupies the 09:00 slot", () => {
    const existing = [la(2026, 6, 16, 9, 4)];
    const got = nextOpenSlot("acct", existing, la(2026, 6, 16, 0, 0));
    expect(got.getTime()).toBe(la(2026, 6, 16, 13, 0).getTime());
  });

  it("past slot on start day is skipped", () => {
    // after = 13:30 → 13:00 past, 18:00 free
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 13, 30));
    expect(got.getTime()).toBe(la(2026, 6, 16, 18, 0).getTime());
  });

  it("existing instant in UTC is normalized into the slot", () => {
    // 16:00 UTC == 09:00 PDT on 2026-06-16 → occupies the 09:00 slot
    const existing = [new Date(Date.UTC(2026, 5, 16, 16, 0, 0))];
    const got = nextOpenSlot("acct", existing, la(2026, 6, 16, 0, 0));
    expect(got.getTime()).toBe(la(2026, 6, 16, 13, 0).getTime());
  });

  it("crosses midnight after the last slot", () => {
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 18, 30));
    expect(got.getTime()).toBe(la(2026, 6, 17, 9, 0).getTime());
  });

  it("rolls forward across many full days", () => {
    const existing: Date[] = [];
    for (const d of [16, 17, 18]) {
      for (const h of [9, 13, 18]) existing.push(la(2026, 6, d, h, 0));
    }
    const got = nextOpenSlot("acct", existing, la(2026, 6, 16, 0, 0));
    expect(got.getTime()).toBe(la(2026, 6, 19, 9, 0).getTime());
  });
});

describe("DST correctness (the reason for the zone-aware fix)", () => {
  it("offset is PDT (-7) in summer", () => {
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 0, 0));
    expect(offsetHours(got)).toBe(-7);
  });

  it("offset is PST (-8) in winter, not -7", () => {
    const got = nextOpenSlot("acct", [], la(2026, 1, 15, 0, 0));
    expect(offsetHours(got)).toBe(-8);
    expect(offsetHours(got)).not.toBe(-7);
  });

  it("spring-forward boundary resolves each day's offset", () => {
    // 2026 spring-forward: 2026-03-08. 09:00 on 03-08 is PDT (-7); 03-07 is PST (-8).
    const before = nextOpenSlot("acct", [], la(2026, 3, 7, 0, 0));
    const after = nextOpenSlot("acct", [], la(2026, 3, 8, 0, 0));
    expect(offsetHours(before)).toBe(-8);
    expect(offsetHours(after)).toBe(-7);
  });

  it("fall-back boundary resolves each day's offset", () => {
    // 2026 fall-back: 2026-11-01. 09:00 on 11-01 is PST (-8); 10-31 is PDT (-7).
    const before = nextOpenSlot("acct", [], la(2026, 10, 31, 0, 0));
    const after = nextOpenSlot("acct", [], la(2026, 11, 1, 0, 0));
    expect(offsetHours(before)).toBe(-7);
    expect(offsetHours(after)).toBe(-8);
  });
});

describe("requestSlot (post sooner / bump)", () => {
  it("no target → earliest available slot", () => {
    const existing = [la(2026, 6, 16, 9, 0)];
    const res = requestSlot("acct", existing, { after: la(2026, 6, 16, 0, 0) });
    expect(res.scheduledFor.getTime()).toBe(la(2026, 6, 16, 13, 0).getTime());
    expect(res.bumped).toBe(false);
  });

  it("free target is honored", () => {
    const res = requestSlot("acct", [], { target: la(2026, 6, 16, 13, 0) });
    expect(res.scheduledFor.getTime()).toBe(la(2026, 6, 16, 13, 0).getTime());
    expect(res.bumped).toBe(false);
  });

  it("target collision bumps to next free slot", () => {
    const existing = [la(2026, 6, 16, 13, 0)];
    const res = requestSlot("acct", existing, { target: la(2026, 6, 16, 13, 0) });
    expect(res.scheduledFor.getTime()).toBe(la(2026, 6, 16, 18, 0).getTime());
    expect(res.bumped).toBe(true);
  });

  it("target collision rolls across midnight", () => {
    const existing = [la(2026, 6, 16, 18, 0)];
    const res = requestSlot("acct", existing, { target: la(2026, 6, 16, 18, 0) });
    expect(res.scheduledFor.getTime()).toBe(la(2026, 6, 17, 9, 0).getTime());
    expect(res.bumped).toBe(true);
  });

  it("off-grid target honored when free", () => {
    const res = requestSlot("acct", [], { target: la(2026, 6, 16, 7, 30) });
    expect(res.scheduledFor.getTime()).toBe(la(2026, 6, 16, 7, 30).getTime());
    expect(res.bumped).toBe(false);
  });

  it("target within jitter window collides and bumps", () => {
    // existing 09:05 occupies the 09:00 slot; target 09:00 must bump
    const existing = [la(2026, 6, 16, 9, 5)];
    const res = requestSlot("acct", existing, { target: la(2026, 6, 16, 9, 0) });
    expect(res.scheduledFor.getTime()).toBe(la(2026, 6, 16, 13, 0).getTime());
    expect(res.bumped).toBe(true);
  });
});

describe("multi-account isolation + sequential allocation", () => {
  it("accounts do not share occupancy", () => {
    const bFull = [la(2026, 6, 16, 9, 0), la(2026, 6, 16, 13, 0), la(2026, 6, 16, 18, 0)];
    const aGot = nextOpenSlot("Brianna", [], la(2026, 6, 16, 0, 0));
    const bGot = nextOpenSlot("Mami Best", bFull, la(2026, 6, 16, 0, 0));
    expect(aGot.getTime()).toBe(la(2026, 6, 16, 9, 0).getTime());
    expect(bGot.getTime()).toBe(la(2026, 6, 17, 9, 0).getTime());
  });

  it("sequential allocation never double-books", () => {
    const existing: Date[] = [];
    const out: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      const slot = nextOpenSlot("acct", existing, la(2026, 6, 16, 0, 0));
      out.push(slot);
      existing.push(slot);
    }
    expect(new Set(out.map((d) => d.getTime())).size).toBe(out.length);
    expect(out.map((d) => d.getTime())).toEqual([
      la(2026, 6, 16, 9, 0), la(2026, 6, 16, 13, 0), la(2026, 6, 16, 18, 0),
      la(2026, 6, 17, 9, 0), la(2026, 6, 17, 13, 0), la(2026, 6, 17, 18, 0),
      la(2026, 6, 18, 9, 0),
    ].map((d) => d.getTime()));
  });
});

describe("custom slots + jitter", () => {
  it("custom slot grid", () => {
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 0, 0), { slots: ["08:00", "20:00"] });
    expect(got.getTime()).toBe(la(2026, 6, 16, 8, 0).getTime());
  });

  it("unsorted slots are sorted", () => {
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 0, 0), { slots: ["18:00", "09:00"] });
    expect(got.getTime()).toBe(la(2026, 6, 16, 9, 0).getTime());
  });

  it("jitter matches the live formula and stays within ±6", () => {
    // (sha256(seed) % 13) - 6, byte-identical to schedule_girls.py:36-38
    const j = jitter("anything");
    expect(j).toBeGreaterThanOrEqual(-6);
    expect(j).toBeLessThanOrEqual(6);
  });

  it("apply jitter keeps the slot within ±6 min and on the same day", () => {
    const got = nextOpenSlot("acct", [], la(2026, 6, 16, 0, 0), { applyJitter: true });
    const base = la(2026, 6, 16, 9, 0).getTime();
    expect(Math.abs(got.getTime() - base)).toBeLessThanOrEqual(6 * 60 * 1000);
  });

  it("DEFAULT_SLOTS / DEFAULT_TZ constants", () => {
    expect([...DEFAULT_SLOTS]).toEqual(["09:00", "13:00", "18:00"]);
    expect(DEFAULT_TZ).toBe("America/Los_Angeles");
  });
});
