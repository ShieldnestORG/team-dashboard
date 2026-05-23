import { describe, expect, it } from "vitest";

import { isDegradedAuditResult } from "../services/creditscore.ts";
import type { AuditResult } from "../routes/audit.ts";

// ---------------------------------------------------------------------------
// isDegradedAuditResult — the persistence gate that prevents fake
// all-zero-data audits from being saved as status:"complete".
//
// History:
//   2026-04-30 — introduced after the P0 where Firecrawl-down silently
//     wrote score:30 results with hardcoded alt1/alt2/alt3 competitors.
//     Original rule: pagesScraped===0 OR (structuredData + contentQuality
//     + freshness) === 0.
//   2026-05-23 — the all-subscores-zero clause turned out to fire on
//     genuinely thin sites (example.com itself: real scrape, real
//     markdown, but no JSON-LD / headings / lastmod). Rule swapped to
//     pagesScraped===0 OR total-markdown-length < 100. The markdown
//     length is the actual signal for "crawler returned but with empty
//     body."
// ---------------------------------------------------------------------------

function baseResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    url: "https://example.com",
    score: 75,
    breakdown: {
      aiAccess: { score: 25, max: 25, issues: [] },
      structuredData: { score: 18, max: 25, schemas: ["FAQPage"], issues: [] },
      contentQuality: { score: 14, max: 20, issues: [] },
      freshness: { score: 8, max: 15, issues: [] },
      technical: { score: 10, max: 15, issues: [] },
    },
    competitors: [{ domain: "competitor.com", score: 70 }],
    recommendations: [],
    pagesScraped: 3,
    rawData: [
      {
        url: "https://example.com",
        markdown:
          "# Example\n\nThis fixture has enough markdown body to clear the degraded-detection threshold of 100 chars by a comfortable margin.",
        metadata: {},
      },
    ],
    scannedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isDegradedAuditResult", () => {
  it("returns false for a healthy result", () => {
    expect(isDegradedAuditResult(baseResult())).toBe(false);
  });

  it("returns true when pagesScraped is 0 (crawler outage)", () => {
    expect(isDegradedAuditResult(baseResult({ pagesScraped: 0 }))).toBe(true);
  });

  it("returns true when scrapes 'succeed' but markdown is effectively empty (the 2026-04-30 P0)", () => {
    // Firecrawl can answer 200 with `{success:true, data:{markdown:""}}`
    // when it lost the source page mid-render. pagesScraped is non-zero
    // but the body is empty — we must still treat this as degraded.
    const result = baseResult({
      pagesScraped: 1,
      rawData: [{ url: "https://example.com", markdown: "", metadata: {} }],
    });
    expect(isDegradedAuditResult(result)).toBe(true);
  });

  it("returns true when combined markdown across all scrapes is under the threshold", () => {
    const result = baseResult({
      pagesScraped: 3,
      rawData: [
        { url: "https://a.com/1", markdown: "tiny", metadata: {} },
        { url: "https://a.com/2", markdown: "also tiny", metadata: {} },
        { url: "https://a.com/3", markdown: "", metadata: {} },
      ],
    });
    expect(isDegradedAuditResult(result)).toBe(true);
  });

  it("returns FALSE for thin-but-real sites with all-zero data subscores (2026-05-23 false-positive regression)", () => {
    // example.com itself: Firecrawl returns ~200 chars of real markdown
    // per page, but the homepage has no JSON-LD, no H1/H2, no sitemap
    // lastmod, so all three data subscores collapse to zero. We must
    // NOT classify this as "crawler down" — the score is honest, just
    // low. Showing a "crawler down" error here hides a real result
    // behind a misleading message.
    const exampleDotComMarkdown =
      "Example Domain\n==============\n\nThis domain is for use in documentation examples without needing permission. Avoid use in operations.\n\n[Learn more](https://iana.org/domains/example)";
    const result = baseResult({
      score: 33,
      breakdown: {
        aiAccess: { score: 25, max: 25, issues: [] },
        structuredData: { score: 0, max: 25, schemas: [], issues: ["No structured data schemas detected"] },
        contentQuality: { score: 0, max: 20, issues: ["Homepage content is thin"] },
        freshness: { score: 0, max: 15, issues: ["No date signals"] },
        technical: { score: 8, max: 15, issues: [] },
      },
      pagesScraped: 2,
      rawData: [
        { url: "https://example.com/", markdown: exampleDotComMarkdown, metadata: {} },
        { url: "https://example.com", markdown: exampleDotComMarkdown, metadata: {} },
      ],
    });
    expect(isDegradedAuditResult(result)).toBe(false);
  });
});
