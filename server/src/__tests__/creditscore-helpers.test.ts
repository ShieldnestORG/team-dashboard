import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { signBody } from "../services/creditscore-email-callback.ts";
import { higherCreditscoreTier } from "../services/bundle-entitlements.ts";
import { extractTopRecommendation } from "../services/creditscore-report-agent.ts";
import {
  slugify,
  weakestSignals,
  parseDraftJson,
} from "../services/creditscore-content-agent.ts";
import {
  pickSchemaType,
  wrapInScript,
} from "../services/creditscore-schema-agent.ts";
import {
  extractCompetitorDomains,
  summarizeGap,
} from "../services/creditscore-competitor-agent.ts";
import {
  isoWeekTag,
  startOfMondayUtc,
} from "../services/creditscore-sage-strategist.ts";

// ---------------------------------------------------------------------------
// creditscore-email-callback.signBody — HMAC-SHA256 v1 signing
// ---------------------------------------------------------------------------

describe("signBody", () => {
  it("produces v1= prefix with hex HMAC-SHA256 of the body", () => {
    const body = '{"kind":"welcome_starter","to":"a@b"}';
    const secret = "test-secret";
    const expected =
      "v1=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(signBody(body, secret)).toBe(expected);
  });

  it("is deterministic across calls", () => {
    const a = signBody("hello", "s1");
    const b = signBody("hello", "s1");
    expect(a).toBe(b);
  });

  it("differs when body or secret differs", () => {
    expect(signBody("a", "s")).not.toBe(signBody("b", "s"));
    expect(signBody("a", "s1")).not.toBe(signBody("a", "s2"));
  });
});

// ---------------------------------------------------------------------------
// bundle-entitlements.higherCreditscoreTier — picks higher of two tiers
// ---------------------------------------------------------------------------

describe("higherCreditscoreTier", () => {
  const report = { tier: "report" as const, domains: 1 };
  const starter = { tier: "starter" as const, domains: 1 };
  const growth = { tier: "growth" as const, domains: 1 };
  const pro = { tier: "pro" as const, domains: 1 };

  it("returns null when both are null", () => {
    expect(higherCreditscoreTier(null, null)).toBe(null);
  });

  it("returns whichever side is non-null when the other is null", () => {
    expect(higherCreditscoreTier(starter, null)).toEqual(starter);
    expect(higherCreditscoreTier(null, pro)).toEqual(pro);
  });

  it("picks the higher tier when both are non-null", () => {
    expect(higherCreditscoreTier(starter, pro)).toEqual(pro);
    expect(higherCreditscoreTier(growth, starter)).toEqual(growth);
    expect(higherCreditscoreTier(report, starter)).toEqual(starter);
  });

  it("respects the report < starter < growth < pro ordering", () => {
    expect(higherCreditscoreTier(report, report)).toEqual(report);
    expect(higherCreditscoreTier(pro, growth)).toEqual(pro);
    expect(higherCreditscoreTier(growth, growth)).toEqual(growth);
  });

  it("prefers a (tie goes to first arg) when tiers are equal", () => {
    const a = { tier: "pro" as const, domains: 2 };
    const b = { tier: "pro" as const, domains: 5 };
    // The function uses >= so the left operand wins on ties.
    expect(higherCreditscoreTier(a, b)).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// creditscore-report-agent.extractTopRecommendation
// ---------------------------------------------------------------------------

describe("extractTopRecommendation", () => {
  it("returns null for non-object input", () => {
    expect(extractTopRecommendation(null)).toBe(null);
    expect(extractTopRecommendation("nope")).toBe(null);
  });

  it("returns null when recommendations array is missing or empty", () => {
    expect(extractTopRecommendation({})).toBe(null);
    expect(extractTopRecommendation({ recommendations: [] })).toBe(null);
  });

  it("picks the highest-priority recommendation", () => {
    const input = {
      recommendations: [
        { priority: "low", title: "low-x", impact: "x" },
        { priority: "high", title: "high-y", impact: "y" },
        { priority: "medium", title: "med-z", impact: "z" },
      ],
    };
    expect(extractTopRecommendation(input)).toEqual({
      priority: "high",
      title: "high-y",
      impact: "y",
    });
  });

  it("filters malformed entries", () => {
    const input = {
      recommendations: [
        { priority: "low", title: "ok", impact: "i" },
        "garbage",
        { priority: "high" }, // no title
        null,
      ],
    };
    expect(extractTopRecommendation(input)).toEqual({
      priority: "low",
      title: "ok",
      impact: "i",
    });
  });
});

// ---------------------------------------------------------------------------
// creditscore-content-agent — slugify, weakestSignals, parseDraftJson
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases, strips punctuation, hyphenates whitespace", () => {
    expect(slugify("Hello, World! Page Title")).toBe("hello-world-page-title");
  });

  it("truncates to 60 chars", () => {
    const long = "x".repeat(100);
    expect(slugify(long).length).toBe(60);
  });

  it("preserves digits + single-letter words", () => {
    expect(slugify("A 2026 Q4 Report")).toBe("a-2026-q4-report");
  });
});

describe("weakestSignals", () => {
  it("returns [] for non-object input", () => {
    expect(weakestSignals(null)).toEqual([]);
    expect(weakestSignals("")).toEqual([]);
  });

  it("returns [] when no breakdown is present", () => {
    expect(weakestSignals({})).toEqual([]);
  });

  it("sorts signals by gap descending, filters zero-gap", () => {
    const audit = {
      breakdown: {
        aiAccess: { score: 25, max: 25, issues: [] }, // gap 0 — filtered
        structuredData: { score: 10, max: 25, issues: ["no schemas"] }, // gap 15
        contentQuality: { score: 18, max: 20, issues: [] }, // gap 2
        freshness: { score: 5, max: 15, issues: ["stale"] }, // gap 10
        technical: { score: 15, max: 15, issues: [] }, // gap 0 — filtered
      },
    };
    const out = weakestSignals(audit);
    expect(out.map((s) => s.name)).toEqual([
      "structuredData",
      "freshness",
      "contentQuality",
    ]);
    expect(out[0]?.gap).toBe(15);
    expect(out[0]?.issues).toEqual(["no schemas"]);
  });
});

describe("parseDraftJson", () => {
  it("extracts JSON from a ```json fence", () => {
    const raw = "```json\n" + JSON.stringify({
      title: "T",
      slug: "t",
      targetSignal: "x",
      html: "<h1>Hi</h1>",
      markdown: "# Hi",
    }) + "\n```";
    const out = parseDraftJson(raw, "fallback");
    expect(out?.title).toBe("T");
    expect(out?.slug).toBe("t");
    expect(out?.html).toBe("<h1>Hi</h1>");
  });

  it("falls back to slugifying title when slug is empty", () => {
    const raw = "```json\n" + JSON.stringify({
      title: "My Great AEO Page",
      slug: "",
      html: "<p>x</p>",
    }) + "\n```";
    expect(parseDraftJson(raw, "sig")?.slug).toBe("my-great-aeo-page");
  });

  it("uses fallbackSignal when targetSignal is missing", () => {
    const raw = "```json\n" + JSON.stringify({ title: "T", html: "<p/>" }) + "\n```";
    expect(parseDraftJson(raw, "fallback-signal")?.targetSignal).toBe("fallback-signal");
  });

  it("returns null on unparsable input", () => {
    expect(parseDraftJson("not json at all", "s")).toBe(null);
  });

  it("returns null when required fields are missing", () => {
    const raw = "```json\n" + JSON.stringify({ slug: "x" }) + "\n```";
    expect(parseDraftJson(raw, "s")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// creditscore-schema-agent — pickSchemaType, wrapInScript
// ---------------------------------------------------------------------------

describe("pickSchemaType", () => {
  it("returns FAQPage first when audit has no structured data", () => {
    expect(pickSchemaType({ breakdown: { structuredData: { schemas: [] } } }, [])).toBe(
      "FAQPage",
    );
  });

  it("skips types already present in the audit's detected schemas", () => {
    const audit = {
      breakdown: { structuredData: { schemas: ["FAQPage", "Organization"] } },
    };
    expect(pickSchemaType(audit, [])).toBe("Article");
  });

  it("skips types already delivered in prior cycles", () => {
    const audit = {
      breakdown: { structuredData: { schemas: [] } },
    };
    expect(pickSchemaType(audit, ["FAQPage", "Organization", "Article"])).toBe("Product");
  });

  it("falls back to first candidate when audit has no breakdown and no priors", () => {
    expect(pickSchemaType({}, [])).toBe("FAQPage");
  });
});

describe("wrapInScript", () => {
  it("wraps a JSON-LD object in a script tag with pretty-printed JSON", () => {
    const out = wrapInScript({ "@context": "https://schema.org", "@type": "FAQPage" });
    expect(out.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(out.endsWith("</script>")).toBe(true);
    expect(out).toContain('"@context": "https://schema.org"');
    expect(out).toContain('"@type": "FAQPage"');
  });
});

// ---------------------------------------------------------------------------
// creditscore-competitor-agent — extractCompetitorDomains, summarizeGap
// ---------------------------------------------------------------------------

describe("extractCompetitorDomains", () => {
  it("returns [] for non-object input", () => {
    expect(extractCompetitorDomains(null)).toEqual([]);
  });

  it("dedupes, lowercases, strips protocol + www, drops alt* placeholders", () => {
    const audit = {
      competitors: [
        { domain: "https://Rival.com/path" },
        { domain: "www.Rival.com" }, // dedupe
        { domain: "another.io" },
        { domain: "alt1.example.com" }, // placeholder filter
        { domain: "" }, // empty filter
      ],
    };
    expect(extractCompetitorDomains(audit)).toEqual(["rival.com", "another.io"]);
  });

  it("handles missing competitors array", () => {
    expect(extractCompetitorDomains({})).toEqual([]);
    expect(extractCompetitorDomains({ competitors: null })).toEqual([]);
  });
});

describe("summarizeGap", () => {
  function fakeAudit(score: number, topSignal: string, topScore: number, topMax: number) {
    return {
      url: "https://x.com",
      score,
      breakdown: {
        aiAccess: { score: 0, max: 25, issues: [] },
        structuredData: { score: 0, max: 25, schemas: [], issues: [] },
        contentQuality: { score: 0, max: 20, issues: [] },
        freshness: { score: 0, max: 15, issues: [] },
        technical: { score: 0, max: 15, issues: [] },
        [topSignal]: { score: topScore, max: topMax, issues: [] },
      },
      competitors: [],
      recommendations: [],
      scannedAt: "",
    } as unknown as Parameters<typeof summarizeGap>[1];
  }

  it("reports ahead when competitor is higher", () => {
    const s = summarizeGap(60, fakeAudit(80, "aiAccess", 25, 25));
    expect(s.startsWith("20 pts ahead")).toBe(true);
    expect(s).toContain("Strongest signal: aiAccess");
  });

  it("reports behind when competitor is lower", () => {
    const s = summarizeGap(80, fakeAudit(60, "technical", 15, 15));
    expect(s.startsWith("20 pts behind")).toBe(true);
  });

  it("reports tied when scores match", () => {
    const s = summarizeGap(70, fakeAudit(70, "freshness", 15, 15));
    expect(s.startsWith("0 pts tied")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// creditscore-sage-strategist — isoWeekTag, startOfMondayUtc
// ---------------------------------------------------------------------------

describe("isoWeekTag", () => {
  it("formats ISO week correctly for a Wednesday", () => {
    // 2026-04-22 is a Wednesday → ISO week 17.
    expect(isoWeekTag(new Date("2026-04-22T12:00:00Z"))).toBe("2026-W17");
  });

  it("zero-pads single-digit weeks", () => {
    // 2026-01-07 is Wednesday of ISO week 2.
    expect(isoWeekTag(new Date("2026-01-07T00:00:00Z"))).toBe("2026-W02");
  });

  it("handles a Monday (first day of ISO week)", () => {
    // 2026-04-20 is Monday → week 17.
    expect(isoWeekTag(new Date("2026-04-20T00:00:00Z"))).toBe("2026-W17");
  });

  it("handles a Sunday (last day of prior ISO week)", () => {
    // 2026-04-19 is Sunday → still week 16.
    expect(isoWeekTag(new Date("2026-04-19T23:59:00Z"))).toBe("2026-W16");
  });
});

describe("startOfMondayUtc", () => {
  it("returns the input itself when it's already a Monday midnight UTC", () => {
    const monday = new Date("2026-04-20T00:00:00Z");
    const out = startOfMondayUtc(monday);
    expect(out.toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });

  it("rolls back to the most recent Monday for mid-week dates", () => {
    const wed = new Date("2026-04-22T14:30:00Z");
    expect(startOfMondayUtc(wed).toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });

  it("rolls Sunday back 6 days", () => {
    const sun = new Date("2026-04-19T10:00:00Z");
    expect(startOfMondayUtc(sun).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  it("normalizes to midnight UTC", () => {
    const afternoon = new Date("2026-04-22T23:45:13Z");
    const out = startOfMondayUtc(afternoon);
    expect(out.getUTCHours()).toBe(0);
    expect(out.getUTCMinutes()).toBe(0);
    expect(out.getUTCSeconds()).toBe(0);
  });
});
