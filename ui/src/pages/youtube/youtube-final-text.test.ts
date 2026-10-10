// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  checkYoutubeText,
  finalYoutubeDescription,
  utf8Bytes,
  youtubeHashtags,
} from "./youtube-final-text";
// Parity import: the server's own implementation, pulled by relative path.
import {
  checkYoutubeText as serverCheckYoutubeText,
  finalYoutubeDescription as serverFinalYoutubeDescription,
  youtubeHashtags as serverYoutubeHashtags,
} from "../../../../server/src/services/youtube/final-text";

describe("youtube-final-text (ui mirror)", () => {
  it("appends a blank line then the hashtags joined by one space", () => {
    expect(finalYoutubeDescription("a", ["#x", "#y"])).toBe("a\n\n#x #y");
  });

  it("builds a hashtag from a multi-word tag", () => {
    expect(youtubeHashtags(["two words"])).toEqual(["#twowords"]);
  });

  it("counts one emoji as 4 bytes", () => {
    expect(utf8Bytes("😀")).toBe(4);
  });

  it("fits 4,998 letters with no tags, and is 4 bytes over with one tag", () => {
    const description = "a".repeat(4998);
    expect(checkYoutubeText({ description, tags: [] })).toBeNull();
    expect(checkYoutubeText({ description, tags: ["tag"] })).toBe(
      "Description is too long for YouTube by 4 bytes",
    );
  });

  it("refuses a < or > in a title", () => {
    expect(checkYoutubeText({ title: "abc<def", tags: [] })).toBe(
      "Title and description cannot contain < or >",
    );
  });

  it("accepts a title-only check whatever the tags", () => {
    expect(checkYoutubeText({ title: "hello", tags: ["whatever"] })).toBeNull();
  });

  it("refuses an empty title", () => {
    expect(checkYoutubeText({ title: "   ", tags: [] })).toBe(
      "Title must be 1-100 characters",
    );
  });
});

describe("parity with the server implementation", () => {
  const cases: Array<{ title?: string; description?: string; tags: string[] }> = [
    { title: "hello", tags: [] },
    { title: "hello", tags: ["one", "two words"] },
    { title: "", tags: [] },
    { title: "x<y", tags: [] },
    { title: "a".repeat(101), tags: [] },
    { description: "chapters\n00:00 start", tags: ["tag"] },
    { description: "a".repeat(4998), tags: [] },
    { description: "a".repeat(4998), tags: ["tag"] },
    { description: "emoji 😀 here", tags: ["x", "y"] },
    { title: "ok", description: "ok", tags: ["a b", "c"] },
  ];

  it("returns the same sentence for every input", () => {
    for (const c of cases) {
      expect(checkYoutubeText(c)).toBe(serverCheckYoutubeText(c));
    }
  });

  it("builds the same hashtags and final description for every input, each side with its own functions", () => {
    for (const c of cases) {
      expect(youtubeHashtags(c.tags)).toEqual(serverYoutubeHashtags(c.tags));
      expect(finalYoutubeDescription(c.description ?? "", youtubeHashtags(c.tags))).toBe(
        serverFinalYoutubeDescription(c.description ?? "", serverYoutubeHashtags(c.tags)),
      );
    }
  });
});
