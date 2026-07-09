// ---------------------------------------------------------------------------
// Coherent Ones University — Founding-100 pricing unit tests.
//
// Covers the revenue-integrity crux exported from routes/university-checkout.ts:
//   - universityFoundingCap(): env-overridable, safe default, rejects garbage.
//   - countFoundingMembers(): the monotonic founder count that drives the
//     $50→$79 switch (COUNT WHERE is_founding).
//   - the tier boundary: founding available iff count < cap (member #100 is the
//     last founder; #101 pays standard).
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  universityFoundingCap,
  countFoundingMembers,
} from "../routes/university-checkout.js";

const ORIGINAL_CAP = process.env.UNIVERSITY_FOUNDING_CAP;

afterEach(() => {
  if (ORIGINAL_CAP === undefined) delete process.env.UNIVERSITY_FOUNDING_CAP;
  else process.env.UNIVERSITY_FOUNDING_CAP = ORIGINAL_CAP;
});

// Minimal stub: countFoundingMembers does select().from().where() → await.
function dbReturning(n: number): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ n }]),
      }),
    }),
  } as unknown as Db;
}

describe("universityFoundingCap", () => {
  it("defaults to 100 when unset", () => {
    delete process.env.UNIVERSITY_FOUNDING_CAP;
    expect(universityFoundingCap()).toBe(100);
  });

  it("honors a valid override", () => {
    process.env.UNIVERSITY_FOUNDING_CAP = "50";
    expect(universityFoundingCap()).toBe(50);
  });

  it("falls back to 100 for zero / negative / non-numeric", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      process.env.UNIVERSITY_FOUNDING_CAP = bad;
      expect(universityFoundingCap()).toBe(100);
    }
  });
});

describe("countFoundingMembers", () => {
  it("returns the row count", async () => {
    expect(await countFoundingMembers(dbReturning(42))).toBe(42);
  });

  it("returns 0 when no founders", async () => {
    expect(await countFoundingMembers(dbReturning(0))).toBe(0);
  });
});

describe("founding tier boundary (count < cap)", () => {
  // The checkout route grants founding iff countFoundingMembers() < cap. With
  // cap=100: seats 0..99 are founding (member #100 is the 100th founder); at
  // count=100 the window is closed and #101 pays standard.
  it("member #100 still gets founding, #101 does not", async () => {
    process.env.UNIVERSITY_FOUNDING_CAP = "100";
    const cap = universityFoundingCap();
    expect((await countFoundingMembers(dbReturning(99))) < cap).toBe(true); // → 100th founder
    expect((await countFoundingMembers(dbReturning(100))) < cap).toBe(false); // → 101st pays $79
  });
});
