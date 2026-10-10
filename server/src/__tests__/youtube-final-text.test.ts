// ---------------------------------------------------------------------------
// final-text.ts — the one shared source of truth for YouTube final text.
// Pure functions: hashtag rule, description join, byte length, and the edit
// route's limit check (bytes, not characters; no < or >).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  finalYoutubeDescription,
  youtubeHashtags,
  utf8Bytes,
  checkYoutubeText,
} from "../services/youtube/final-text.js";

describe("finalYoutubeDescription / youtubeHashtags", () => {
  it("joins description + blank line + hashtags by one space", () => {
    expect(finalYoutubeDescription("a", ["#x", "#y"])).toBe("a\n\n#x #y");
  });

  it("strips whitespace inside a tag before prefixing #", () => {
    expect(youtubeHashtags(["two words"])).toEqual(["#twowords"]);
  });
});

describe("utf8Bytes", () => {
  it("counts bytes, not characters", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("\u{1F600}")).toBe(4);
  });
});

describe("checkYoutubeText", () => {
  it("returns null for a fine title/description", () => {
    expect(checkYoutubeText({ title: "Ok", description: "fine", tags: [] })).toBeNull();
  });

  it("refuses a description of 4,990 plain letters plus 5 emoji (bytes, not characters)", () => {
    const description = "a".repeat(4990) + "\u{1F600}".repeat(5);
    expect(description.length).toBeLessThanOrEqual(5000); // fits as characters
    const err = checkYoutubeText({ title: "Ok", description, tags: [] });
    expect(err).toBeTruthy();
    expect(err).toMatch(/^Description is too long for YouTube by \d+ bytes$/);
  });

  it("passes 4,990 plain letters with no tags", () => {
    expect(checkYoutubeText({ title: "Ok", description: "a".repeat(4990), tags: [] })).toBeNull();
  });

  it("counts the row's tags toward the limit", () => {
    // 4,998 letters + blank line (2) = 5,000 bytes: exactly at the limit alone.
    // Append "#tag" (4 more bytes) and it must be refused.
    const description = "a".repeat(4998);
    expect(utf8Bytes(finalYoutubeDescription(description, youtubeHashtags(["tag"])))).toBe(5004);
    expect(checkYoutubeText({ title: "Ok", description, tags: [] })).toBeNull();
    expect(checkYoutubeText({ title: "Ok", description, tags: ["tag"] })).toBe(
      "Description is too long for YouTube by 4 bytes",
    );
  });

  it("refuses < in a title", () => {
    expect(checkYoutubeText({ title: "a < b", description: "fine", tags: [] })).toBe(
      "Title and description cannot contain < or >",
    );
  });

  it("refuses > in a description", () => {
    expect(checkYoutubeText({ title: "Ok", description: "a > b", tags: [] })).toBe(
      "Title and description cannot contain < or >",
    );
  });

  it("checks only the fields it is given", () => {
    // A title-only edit: no description rule can fire.
    expect(checkYoutubeText({ title: "Ok", tags: ["tag"] })).toBeNull();
    // A description-only edit: the missing title is not "empty".
    expect(checkYoutubeText({ description: "fine", tags: [] })).toBeNull();
    expect(checkYoutubeText({ description: "a > b", tags: [] })).toBe(
      "Title and description cannot contain < or >",
    );
  });

  it("refuses an empty/overlong title", () => {
    expect(checkYoutubeText({ title: "   ", description: "fine", tags: [] })).toBe(
      "Title must be 1-100 characters",
    );
    expect(checkYoutubeText({ title: "a".repeat(101), description: "fine", tags: [] })).toBe(
      "Title must be 1-100 characters",
    );
  });
});
