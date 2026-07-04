// ---------------------------------------------------------------------------
// Pure-function coverage for the socials-polish backfill/serializer logic in
// zernio-analytics.ts:
//   - buildPlatformEntries / extractPlatformPostIds: the posted_url backfill
//     matching inputs (posted_url stays null after Zernio publish today —
//     see zernio.ts's pickPostUrl TODO — so the analytics ingest backfills it
//     by correlating platform_post_id -> platform_post_url).
//   - probeFollowerCount: the follower-count serializer's defensive JSON probe.
// No DB required — these are the pure pieces extracted out of the ingest.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  buildPlatformEntries,
  extractPlatformPostIds,
  latestFollowerCounts,
  probeFollowerCount,
} from "../services/socials/zernio-analytics.js";

function fakeDb(rows: Array<Record<string, unknown>>): Db {
  return { execute: async () => rows } as unknown as Db;
}

describe("buildPlatformEntries", () => {
  it("uses the platforms[] breakdown when present", () => {
    const post = {
      platforms: [{ platform: "instagram" }, { platform: "tiktok" }],
      platform: "ignored-top-level",
    };
    const entries = buildPlatformEntries(post);
    expect(entries).toHaveLength(2);
    expect(entries[0].platform).toBe("instagram");
    expect(entries[1].platform).toBe("tiktok");
  });

  it("synthesizes a single entry from top-level fields when platforms[] is absent", () => {
    const post = { platform: "bluesky", platformPostUrl: "https://bsky.app/x", analytics: { likes: 3 } };
    const entries = buildPlatformEntries(post);
    expect(entries).toEqual([
      { platform: "bluesky", platformPostUrl: "https://bsky.app/x", analytics: { likes: 3 } },
    ]);
  });

  it("synthesizes a single entry when platforms[] is an empty array", () => {
    const post = { platforms: [], platform: "instagram" };
    expect(buildPlatformEntries(post)).toHaveLength(1);
  });
});

describe("extractPlatformPostIds", () => {
  it("extracts both ids when present as strings", () => {
    expect(
      extractPlatformPostIds({ platformPostId: "pid_1", platformPostUrl: "https://ig.com/p/1" }),
    ).toEqual({ platformPostId: "pid_1", platformPostUrl: "https://ig.com/p/1" });
  });

  it("returns null for missing fields", () => {
    expect(extractPlatformPostIds({})).toEqual({ platformPostId: null, platformPostUrl: null });
  });

  it("returns null for non-string values (defensive against opaque Zernio JSON)", () => {
    expect(
      extractPlatformPostIds({ platformPostId: 12345, platformPostUrl: null }),
    ).toEqual({ platformPostId: null, platformPostUrl: null });
  });
});

describe("probeFollowerCount", () => {
  it("probes the first matching candidate key", () => {
    expect(probeFollowerCount({ followers: 1200 })).toBe(1200);
    expect(probeFollowerCount({ followerCount: 900 })).toBe(900);
    expect(probeFollowerCount({ follower_count: "450" })).toBe(450);
    expect(probeFollowerCount({ totalFollowers: 10 })).toBe(10);
  });

  it("returns null (never 0) when no candidate key is present", () => {
    expect(probeFollowerCount({ growth: -3, username: "bribriwaifu" })).toBeNull();
    expect(probeFollowerCount({})).toBeNull();
    expect(probeFollowerCount(null)).toBeNull();
    expect(probeFollowerCount(undefined)).toBeNull();
  });

  it("ignores non-numeric-looking string values", () => {
    expect(probeFollowerCount({ followers: "n/a" })).toBeNull();
  });
});

describe("latestFollowerCounts (accounts serializer join)", () => {
  it("maps zernio_account_id -> follower count from the latest follower-stats snapshot", async () => {
    const db = fakeDb([
      {
        metric: "follower-stats",
        zernioAccountId: "z1",
        addonMissing: false,
        data: { accounts: [{ username: "bribriwaifu", followers: 1250 }] },
        fetchedAt: "2026-07-03T00:00:00Z",
      },
      {
        metric: "follower-stats",
        zernioAccountId: "z2",
        addonMissing: false,
        // no usable count on this account's entries -> stays absent from the map
        data: { accounts: [{ username: "other", growth: -2 }] },
        fetchedAt: "2026-07-03T00:00:00Z",
      },
    ]);
    const counts = await latestFollowerCounts(db);
    expect(counts.get("z1")).toBe(1250);
    expect(counts.has("z2")).toBe(false); // absent, never 0
  });

  it("returns an empty map when there are no follower-stats snapshots", async () => {
    const counts = await latestFollowerCounts(fakeDb([]));
    expect(counts.size).toBe(0);
  });
});
