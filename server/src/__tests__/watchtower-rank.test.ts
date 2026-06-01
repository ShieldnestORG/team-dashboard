// ---------------------------------------------------------------------------
// Watchtower rank tests — pure rank computation + runRankCheck fan-out with an
// injected search fn (no Firecrawl, no DB, no network).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import {
  normalizeHost,
  computeRankFromResults,
  runRankCheck,
  type RankSearchFn,
} from "../services/watchtower-rank.js";

describe("normalizeHost", () => {
  it("strips scheme, www, path, and port; lowercases", () => {
    expect(normalizeHost("https://www.RogueDefender.law/foo?x=1")).toBe(
      "roguedefender.law",
    );
    expect(normalizeHost("roguedefender.law")).toBe("roguedefender.law");
    expect(normalizeHost("http://roguedefender.law:8080")).toBe(
      "roguedefender.law",
    );
    expect(normalizeHost("")).toBe("");
  });
});

describe("computeRankFromResults", () => {
  const results = [
    { url: "https://avvo.com/medford" },
    { url: "https://www.roguedefender.law/dui" },
    { url: "https://justia.com" },
  ];

  it("returns the 1-based position of the first matching host", () => {
    const r = computeRankFromResults("roguedefender.law", results);
    expect(r.position).toBe(2);
    expect(r.matchedUrl).toBe("https://www.roguedefender.law/dui");
    expect(r.topUrl).toBe("https://avvo.com/medford");
  });

  it("matches subdomains of the target", () => {
    const r = computeRankFromResults("roguedefender.law", [
      { url: "https://blog.roguedefender.law/post" },
    ]);
    expect(r.position).toBe(1);
  });

  it("does NOT match a domain that merely contains the target as a substring", () => {
    const r = computeRankFromResults("defender.law", [
      { url: "https://notdefender.law/x" },
    ]);
    expect(r.position).toBeNull();
    expect(r.matchedUrl).toBeNull();
  });

  it("returns position=null with topUrl when the brand is absent", () => {
    const r = computeRankFromResults("roguedefender.law", [
      { url: "https://avvo.com" },
    ]);
    expect(r.position).toBeNull();
    expect(r.topUrl).toBe("https://avvo.com");
  });

  it("handles an empty result set", () => {
    const r = computeRankFromResults("roguedefender.law", []);
    expect(r).toEqual({ position: null, matchedUrl: null, topUrl: null });
  });
});

describe("runRankCheck", () => {
  it("returns one entry per query, preserving order under concurrency", async () => {
    const search: RankSearchFn = async (query) => {
      if (query === "dui lawyer medford or") {
        return [
          { title: "", url: "https://avvo.com", content: "" },
          { title: "", url: "https://roguedefender.law", content: "" },
        ];
      }
      return [{ title: "", url: "https://example.com", content: "" }];
    };
    const out = await runRankCheck(
      "roguedefender.law",
      ["dui lawyer medford or", "expungement medford"],
      search,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ query: "dui lawyer medford or", position: 2 });
    expect(out[1]).toMatchObject({ query: "expungement medford", position: null });
  });

  it("is fail-soft: a throwing query yields position=null, not a rejection", async () => {
    const search = vi.fn<RankSearchFn>(async (query) => {
      if (query === "boom") throw new Error("firecrawl down");
      return [{ title: "", url: "https://roguedefender.law", content: "" }];
    });
    const out = await runRankCheck("roguedefender.law", ["ok", "boom"], search);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.query === "ok")?.position).toBe(1);
    expect(out.find((e) => e.query === "boom")).toMatchObject({
      position: null,
      matchedUrl: null,
      topUrl: null,
    });
  });

  it("drops blank queries", async () => {
    const search: RankSearchFn = async () => [];
    const out = await runRankCheck("roguedefender.law", ["", "  ", "real"], search);
    expect(out.map((e) => e.query)).toEqual(["real"]);
  });
});
