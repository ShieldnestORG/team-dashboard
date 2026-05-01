import { describe, expect, it } from "vitest";

import { isDegradedAuditResult } from "../services/creditscore.ts";
import type { AuditResult } from "../routes/audit.ts";

// ---------------------------------------------------------------------------
// isDegradedAuditResult — the persistence gate that prevents fake
// score:30 / all-zero-data audits from being saved as status:"complete".
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
      { url: "https://example.com", markdown: "# Hello", metadata: {} },
    ],
    scannedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isDegradedAuditResult", () => {
  it("returns false for a healthy result", () => {
    expect(isDegradedAuditResult(baseResult())).toBe(false);
  });

  it("returns true when pagesScraped is 0", () => {
    expect(isDegradedAuditResult(baseResult({ pagesScraped: 0 }))).toBe(true);
  });

  it("returns true when all three data subscores are 0 (the prod symptom)", () => {
    // This is exactly what the live smoke test against
    // https://api.coherencedaddy.com produced when Firecrawl was down:
    // score:30 from aiAccess+technical, all data subscores zero.
    const result = baseResult({
      score: 30,
      pagesScraped: 1, // map returned a page but markdown was empty
      breakdown: {
        aiAccess: { score: 25, max: 25, issues: [] },
        structuredData: { score: 0, max: 25, schemas: [], issues: ["No schemas detected"] },
        contentQuality: { score: 0, max: 20, issues: ["Thin content"] },
        freshness: { score: 0, max: 15, issues: ["No date signals"] },
        technical: { score: 5, max: 15, issues: [] },
      },
    });
    expect(isDegradedAuditResult(result)).toBe(true);
  });

  it("returns false when at least one data subscore is non-zero", () => {
    const result = baseResult({
      breakdown: {
        ...baseResult().breakdown,
        structuredData: { score: 0, max: 25, schemas: [], issues: [] },
        contentQuality: { score: 3, max: 20, issues: [] },
        freshness: { score: 0, max: 15, issues: [] },
      },
    });
    expect(isDegradedAuditResult(result)).toBe(false);
  });

  it("does NOT count aiAccess + technical toward degraded check", () => {
    // A page that's just robots.txt + HTTPS shouldn't get a 'complete' label
    // even with full ai-access and technical signals.
    const result = baseResult({
      score: 40,
      breakdown: {
        aiAccess: { score: 25, max: 25, issues: [] },
        structuredData: { score: 0, max: 25, schemas: [], issues: [] },
        contentQuality: { score: 0, max: 20, issues: [] },
        freshness: { score: 0, max: 15, issues: [] },
        technical: { score: 15, max: 15, issues: [] },
      },
    });
    expect(isDegradedAuditResult(result)).toBe(true);
  });
});
