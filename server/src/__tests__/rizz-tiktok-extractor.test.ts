import { describe, expect, it } from "vitest";
import {
  computeBioSpecificityScore,
  parseProfileFromMarkdown,
  parseShortNumber,
  parseVideoUrls,
  pickTop3Receipts,
} from "../services/rizz-tiktok-extractor.ts";

describe("parseShortNumber", () => {
  it("parses plain integers", () => {
    expect(parseShortNumber("1234")).toBe(1234);
  });
  it("parses comma-separated integers", () => {
    expect(parseShortNumber("1,234,567")).toBe(1234567);
  });
  it("parses K suffix", () => {
    expect(parseShortNumber("12.5K")).toBe(12500);
  });
  it("parses M suffix", () => {
    expect(parseShortNumber("3.2M")).toBe(3200000);
  });
  it("parses B suffix", () => {
    expect(parseShortNumber("1.1B")).toBe(1100000000);
  });
  it("returns undefined on garbage input", () => {
    expect(parseShortNumber("nope")).toBeUndefined();
    expect(parseShortNumber("")).toBeUndefined();
  });
});

describe("parseProfileFromMarkdown", () => {
  it("extracts followers, following, and totalLikes when present in standard rendering", () => {
    const md = `
      # Some Handle
      1.2M Followers
      234 Following
      45.6M Likes
      Engineer building tools for solo founders.
    `;
    const profile = parseProfileFromMarkdown(md);
    expect(profile.followers).toBe(1_200_000);
    expect(profile.following).toBe(234);
    expect(profile.totalLikes).toBe(45_600_000);
  });

  it("returns an empty profile when nothing is parseable", () => {
    expect(parseProfileFromMarkdown("just nav: For You · Following · Inbox")).toEqual({});
  });

  it("captures a bio candidate from a non-nav, non-link line", () => {
    const md =
      "# heading\n[link](https://x.com)\nFor You\nBuilder coaching new creators in 2026.\n";
    const profile = parseProfileFromMarkdown(md);
    expect(profile.bio).toBe("Builder coaching new creators in 2026.");
  });

  it("captures a non-tiktok external link", () => {
    const md = "Some bio\nhttps://my-portfolio.example.com/landing\n";
    const profile = parseProfileFromMarkdown(md);
    expect(profile.link).toBe("https://my-portfolio.example.com/landing");
  });
});

describe("parseVideoUrls", () => {
  it("dedupes by numeric video id", () => {
    const md = `
      [a](https://www.tiktok.com/@some/video/7234567890123456789)
      [a-again](https://www.tiktok.com/@some/video/7234567890123456789)
      [b](https://www.tiktok.com/@other/video/7345678901234567890)
    `;
    const out = parseVideoUrls(md);
    expect(out.length).toBe(2);
    expect(out.map((v) => v.videoId).sort()).toEqual([
      "7234567890123456789",
      "7345678901234567890",
    ]);
  });
});

describe("computeBioSpecificityScore", () => {
  it("returns null for empty / missing bio", () => {
    expect(computeBioSpecificityScore(undefined)).toBeNull();
    expect(computeBioSpecificityScore("")).toBeNull();
    expect(computeBioSpecificityScore("xy")).toBeNull();
  });

  it("scores a generic bio low", () => {
    const score = computeBioSpecificityScore("creator. lover of life. follow for more");
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(0.5);
  });

  it("scores a specific niche bio higher", () => {
    const score = computeBioSpecificityScore(
      "Founder of a 2-person coaching agency, growth-for-creators with 800 followers",
    );
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0.5);
  });

  it("clamps to [0, 1]", () => {
    const score = computeBioSpecificityScore(
      "founder engineer designer coach teacher writer trainer for creators in 2024 with growth",
    );
    expect(score).not.toBeNull();
    expect(score!).toBeLessThanOrEqual(1);
    expect(score!).toBeGreaterThanOrEqual(0);
  });
});

describe("pickTop3Receipts", () => {
  it("returns the first 3 video ids in profile order", () => {
    const videos = [
      { videoId: "v1" },
      { videoId: "v2" },
      { videoId: "v3" },
      { videoId: "v4" },
    ];
    expect(pickTop3Receipts(videos)).toEqual(["v1", "v2", "v3"]);
  });

  it("returns whatever is available when fewer than 3 videos", () => {
    expect(pickTop3Receipts([{ videoId: "only" }])).toEqual(["only"]);
    expect(pickTop3Receipts([])).toEqual([]);
  });
});
