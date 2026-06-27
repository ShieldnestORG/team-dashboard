// ---------------------------------------------------------------------------
// Firecrawl provenance stamping tests — Rule 6.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  asStatedOn,
  attributionDate,
  extractDateline,
  isStale,
  stampCrawl,
  toSourceRef,
} from "../services/trends-digest/firecrawl-stamp.js";

describe("extractDateline", () => {
  it("parses an ISO date", () => {
    expect(extractDateline("Body text. 2026-06-25. More.")).toBe("2026-06-25");
  });

  it("parses 'Month DD, YYYY'", () => {
    expect(extractDateline("Posted June 25, 2026 by staff")).toBe(
      "June 25, 2026",
    );
  });

  it("prefers an explicitly labelled publish date over an incidental one", () => {
    const text = "Event was on May 1, 2020. Published: 2026-06-25.";
    expect(extractDateline(text)).toBe("2026-06-25");
  });

  it("returns null when no date is present", () => {
    expect(extractDateline("No dates here at all.")).toBeNull();
  });
});

describe("stampCrawl + toSourceRef", () => {
  it("stamps fetch time and dateline, derives publisher from host", () => {
    const crawl = stampCrawl(
      "https://www.example.com/post",
      "Published: 2026-06-25. Hello.",
      "2026-06-26T09:00:00.000Z",
    );
    expect(crawl.fetchedAt).toBe("2026-06-26T09:00:00.000Z");
    expect(crawl.dateline).toBe("2026-06-25");

    const ref = toSourceRef(crawl, { title: "Hello" });
    expect(ref.publisher).toBe("example.com");
    expect(ref.dateline).toBe("2026-06-25");
    expect(ref.title).toBe("Hello");
  });
});

describe("attributionDate + asStatedOn", () => {
  it("uses the page dateline when present", () => {
    const ref = {
      url: "https://example.com/x",
      publisher: "Example",
      fetchedAt: "2026-06-26T09:00:00.000Z",
      dateline: "June 25, 2026",
    };
    expect(attributionDate(ref)).toBe("June 25, 2026");
    expect(asStatedOn("$0.0123", ref)).toBe(
      "$0.0123 (as stated on Example, June 25, 2026)",
    );
  });

  it("falls back to the crawl date when there is no dateline", () => {
    const ref = {
      url: "https://example.com/x",
      publisher: "Example",
      fetchedAt: "2026-06-26T09:00:00.000Z",
      dateline: null,
    };
    expect(attributionDate(ref)).toBe("2026-06-26");
    expect(asStatedOn("177 points", ref)).toBe(
      "177 points (as stated on Example, 2026-06-26)",
    );
  });
});

describe("isStale", () => {
  const DAY = 24 * 60 * 60 * 1000;
  it("is false within the window", () => {
    const now = Date.parse("2026-06-26T12:00:00.000Z");
    expect(isStale("2026-06-26T06:00:00.000Z", DAY, now)).toBe(false);
  });
  it("is true past the window", () => {
    const now = Date.parse("2026-06-26T12:00:00.000Z");
    expect(isStale("2026-06-24T06:00:00.000Z", DAY, now)).toBe(true);
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(isStale("not-a-date", DAY)).toBe(true);
  });
});
