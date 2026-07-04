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
  sanitizePostedUrl,
  upsertPostAnalytics,
} from "../services/socials/zernio-analytics.js";

function fakeDb(rows: Array<Record<string, unknown>>): Db {
  return { execute: async () => rows } as unknown as Db;
}

/** Flatten a drizzle sql`` object (static chunks + bound params) to one string. */
function sqlToText(q: unknown): string {
  const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (c === null || typeof c !== "object") {
        return typeof c === "string" || typeof c === "number" ? String(c) : "";
      }
      const v = (c as { value?: unknown }).value;
      if (Array.isArray(v)) return v.join("");
      return typeof v === "string" || typeof v === "number" ? String(v) : "";
    })
    .join("");
}

function capturingDb(): { db: Db; queries: string[] } {
  const queries: string[] = [];
  const db = {
    execute: async (q: unknown) => {
      queries.push(sqlToText(q));
      return [];
    },
  } as unknown as Db;
  return { db, queries };
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

describe("sanitizePostedUrl", () => {
  it("passes through plain http/https URLs", () => {
    expect(sanitizePostedUrl("https://instagram.com/p/abc")).toBe("https://instagram.com/p/abc");
    expect(sanitizePostedUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("rejects javascript:/data:/other schemes and junk", () => {
    expect(sanitizePostedUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePostedUrl("JavaScript:alert(1)")).toBeNull();
    expect(sanitizePostedUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizePostedUrl("vbscript:msgbox(1)")).toBeNull();
    expect(sanitizePostedUrl("not a url")).toBeNull();
    expect(sanitizePostedUrl("")).toBeNull();
    expect(sanitizePostedUrl(null)).toBeNull();
  });
});

describe("upsertPostAnalytics posted_url backfill guard", () => {
  const post = (url: string): Record<string, unknown> => ({
    _id: "ext_1",
    platforms: [{ platform: "instagram", platformPostId: "pid_1", platformPostUrl: url }],
  });

  it("backfills posted_url from a plain https permalink, scoped to the ingesting account", async () => {
    const { db, queries } = capturingDb();
    await upsertPostAnalytics(db, "zid_1", post("https://instagram.com/p/abc"));
    const update = queries.find((q) => q.includes("UPDATE social_posts"));
    expect(update).toBeDefined();
    expect(update).toContain("https://instagram.com/p/abc");
    expect(update).toContain("posted_url IS NULL"); // never clobbers an existing value
    // account-scoped: joins social_accounts on the ingesting zernio account id,
    // so a platform_post_id collision across accounts can't cross-wire posts.
    expect(update).toContain("zernio_account_id");
    expect(update).toContain("zid_1");
  });

  it("never lands a hostile URL in posted_url (no UPDATE issued)", async () => {
    for (const hostile of ["javascript:alert(1)", "data:text/html,x", "not a url"]) {
      const { db, queries } = capturingDb();
      await upsertPostAnalytics(db, "zid_1", post(hostile));
      expect(queries.some((q) => q.includes("UPDATE social_posts"))).toBe(false);
      // the analytics upsert itself still happens — only the href-bound
      // social_posts.posted_url write is suppressed.
      expect(queries.some((q) => q.includes("INSERT INTO zernio_post_analytics"))).toBe(true);
    }
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
