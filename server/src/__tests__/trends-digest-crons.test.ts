// ---------------------------------------------------------------------------
// Digest cron cadence tests — the community-unlocked bonus gate (§1.9). The
// engagement counter is injected; no DB.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { bonusRunUnlocked } from "../services/trends-digest/digest-crons.js";

// db is never touched because countEngagement is injected.
const db = {} as never;

describe("bonusRunUnlocked", () => {
  it("unlocks when engagement meets the threshold", async () => {
    const ok = await bonusRunUnlocked(db, {
      countEngagement: async () => 12,
      threshold: 10,
    });
    expect(ok).toBe(true);
  });

  it("unlocks exactly at the threshold", async () => {
    expect(
      await bonusRunUnlocked(db, { countEngagement: async () => 10, threshold: 10 }),
    ).toBe(true);
  });

  it("stays locked below the threshold", async () => {
    expect(
      await bonusRunUnlocked(db, { countEngagement: async () => 3, threshold: 10 }),
    ).toBe(false);
  });
});
