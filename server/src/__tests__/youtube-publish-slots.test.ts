import { describe, it, expect } from "vitest";
import {
  localWallTimeToUtc,
  nextFreeSlot,
  resolvePublishTime,
  slotConfigFromEnv,
} from "../services/youtube/publish-slots.js";

const LA = "America/Los_Angeles";
const DEFAULT_CFG = { perDay: 1, hours: [7], timeZone: LA };

describe("localWallTimeToUtc", () => {
  it("converts a PDT wall time to UTC", () => {
    expect(localWallTimeToUtc(2026, 10, 9, 7, LA).toISOString()).toBe(
      "2026-10-09T14:00:00.000Z",
    );
  });

  it("converts a PST wall time to UTC", () => {
    expect(localWallTimeToUtc(2026, 12, 9, 7, LA).toISOString()).toBe(
      "2026-12-09T15:00:00.000Z",
    );
  });
});

describe("nextFreeSlot", () => {
  it("returns today's 07:00 slot when nothing is taken and now is early", () => {
    const now = new Date("2026-10-08T05:00:00Z");
    expect(nextFreeSlot(now, [], DEFAULT_CFG).toISOString()).toBe(
      "2026-10-08T14:00:00.000Z",
    );
  });

  it("defers to the next day when now is under an hour before the slot", () => {
    const now = new Date("2026-10-08T13:30:00Z");
    expect(nextFreeSlot(now, [], DEFAULT_CFG).toISOString()).toBe(
      "2026-10-09T14:00:00.000Z",
    );
  });

  it("skips a slot that is already taken", () => {
    const now = new Date("2026-10-08T05:00:00Z");
    const taken = [new Date("2026-10-08T14:00:00Z")];
    expect(nextFreeSlot(now, taken, DEFAULT_CFG).toISOString()).toBe(
      "2026-10-09T14:00:00.000Z",
    );
  });

  it("fills the third slot of a perDay=3 day after 07:00 and 12:00 are taken", () => {
    const now = new Date("2026-10-08T05:00:00Z");
    const taken = [
      new Date("2026-10-08T14:00:00Z"), // Oct 8 07:00 PDT
      new Date("2026-10-08T19:00:00Z"), // Oct 8 12:00 PDT
    ];
    const cfg = { perDay: 3, hours: [7, 12, 17], timeZone: LA };
    expect(nextFreeSlot(now, taken, cfg).toISOString()).toBe(
      "2026-10-09T00:00:00.000Z", // Oct 8 17:00 PDT
    );
  });
});

describe("slotConfigFromEnv", () => {
  it("defaults perDay to 1 when out of range", () => {
    expect(slotConfigFromEnv({ YT_PUBLISH_PER_DAY: "9" }).perDay).toBe(1);
  });

  it("sorts and de-duplicates hours", () => {
    const cfg = slotConfigFromEnv({ YT_PUBLISH_PER_DAY: "3", YT_PUBLISH_HOURS: "17,7,12,7" });
    expect(cfg.hours).toEqual([7, 12, 17]);
  });

  it("defaults the time zone when the zone is invalid", () => {
    expect(slotConfigFromEnv({ YT_PUBLISH_TZ: "Mars/Olympus" }).timeZone).toBe(
      "America/Los_Angeles",
    );
  });
});

describe("resolvePublishTime", () => {
  const now = new Date("2026-10-25T22:47:00Z"); // Oct 25 15:47 PDT

  it("moves a time that has already passed to the next free slot", () => {
    const res = resolvePublishTime(new Date("2026-10-12T14:00:00Z"), now, [], DEFAULT_CFG);
    expect(res).toEqual({ publishTime: new Date("2026-10-26T14:00:00Z"), moved: true });
  });

  it("gives a batch of stale approvals one day each, never the same time", () => {
    const taken: Date[] = [];
    for (const stale of ["2026-10-10T14:00:00Z", "2026-10-12T14:00:00Z", "2026-10-13T14:00:00Z"]) {
      const res = resolvePublishTime(new Date(stale), now, taken, DEFAULT_CFG);
      if (!("publishTime" in res)) throw new Error("expected a slot");
      taken.push(res.publishTime);
    }
    expect(taken.map((t) => t.toISOString())).toEqual([
      "2026-10-26T14:00:00.000Z",
      "2026-10-27T14:00:00.000Z",
      "2026-10-28T14:00:00.000Z",
    ]);
  });

  it("keeps a free future time as asked", () => {
    const asked = new Date("2026-10-30T18:00:00Z");
    expect(resolvePublishTime(asked, now, [new Date("2026-10-30T14:00:00Z")], DEFAULT_CFG)).toEqual({
      publishTime: asked,
      moved: false,
    });
  });

  it("refuses a future time within 30 minutes of another queued video", () => {
    const other = new Date("2026-10-30T14:00:00Z");
    expect(resolvePublishTime(new Date("2026-10-30T14:20:00Z"), now, [other], DEFAULT_CFG)).toEqual({
      conflictWith: other,
    });
  });
});
