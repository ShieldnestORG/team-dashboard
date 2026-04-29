import { describe, expect, it } from "vitest";
import {
  extractAtMentions,
  parseVideoUrlsFromMarkdown,
} from "../services/rizz-comment-monitor.ts";

describe("extractAtMentions", () => {
  it("extracts a single @-mention from a comment body", () => {
    expect(extractAtMentions("review @creatorone please", "coherencedaddy")).toEqual([
      "creatorone",
    ]);
  });

  it("extracts multiple unique @-mentions, preserving discovery order", () => {
    expect(
      extractAtMentions(
        "@alpha please look at @bravo and @charlie, also @bravo again",
        "coherencedaddy",
      ),
    ).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("strips trailing punctuation (period, comma, ?, !)", () => {
    expect(extractAtMentions("yo @one. @two? @three! @four,", "coherencedaddy")).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });

  it("excludes the owning handle (case-insensitive) from results", () => {
    expect(
      extractAtMentions("@CoherenceDaddy review @nextone", "coherencedaddy"),
    ).toEqual(["nextone"]);
  });

  it("ignores @-tokens shorter than 2 characters", () => {
    expect(extractAtMentions("@a @bc @d", "coherencedaddy")).toEqual(["bc"]);
  });

  it("preserves mixed-case handles as written (TikTok display) but dedupes case-insensitively", () => {
    // Both reference the same lowercased handle; we keep the first form seen.
    const out = extractAtMentions("@CamelCase mid @camelcase end", "coherencedaddy");
    expect(out.length).toBe(1);
    expect(out[0].toLowerCase()).toBe("camelcase");
  });

  it("returns empty array on empty / mention-free body", () => {
    expect(extractAtMentions("", "coherencedaddy")).toEqual([]);
    expect(extractAtMentions("just normal text", "coherencedaddy")).toEqual([]);
  });

  it("supports handles with dots and underscores", () => {
    expect(
      extractAtMentions("review @first.last and @snake_case_user", "coherencedaddy"),
    ).toEqual(["first.last", "snake_case_user"]);
  });
});

describe("parseVideoUrlsFromMarkdown", () => {
  it("extracts unique video URLs and dedupes by numeric video id", () => {
    const md = `
      [video](https://www.tiktok.com/@coherencedaddy/video/7234567890123456789)
      [same](https://www.tiktok.com/@coherencedaddy/video/7234567890123456789)
      [other](https://www.tiktok.com/@coherencedaddy/video/7345678901234567890)
    `;
    const result = parseVideoUrlsFromMarkdown(md);
    expect(result.length).toBe(2);
    expect(result.map((v) => v.videoId).sort()).toEqual([
      "7234567890123456789",
      "7345678901234567890",
    ]);
  });

  it("returns empty array when no video URLs are present", () => {
    expect(parseVideoUrlsFromMarkdown("just markdown body, no videos")).toEqual([]);
  });

  it("matches videos under any handle (not just the polled one)", () => {
    const md =
      "https://www.tiktok.com/@otherperson/video/9000000000000000001 and " +
      "https://www.tiktok.com/@coherencedaddy/video/9000000000000000002";
    const ids = parseVideoUrlsFromMarkdown(md).map((v) => v.videoId);
    expect(ids).toContain("9000000000000000001");
    expect(ids).toContain("9000000000000000002");
  });
});
