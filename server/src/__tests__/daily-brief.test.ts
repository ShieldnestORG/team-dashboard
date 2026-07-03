// ---------------------------------------------------------------------------
// Daily AI Brief (Phase 3) — pure-function tests.
//
// Two layers, mirroring the code split:
//   1. parseBriefResponse — defensive JSON parsing of the LLM's brief
//      response (strict-JSON happy path, ```json-fenced responses, invalid
//      JSON, non-object top level, wrong-typed fields coerced to safe
//      defaults).
//   2. validateInspirationUrl — the Inspiration board's paste-a-link guard.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  parseBriefResponse,
  validateInspirationUrl,
} from "../services/socials/daily-brief.js";

describe("parseBriefResponse", () => {
  const validPayload = {
    whatWorked: ["Reels posted Tue/Thu outperformed the rest"],
    underutilized: ["@coherencedaddy on TikTok — 1 post in 7 days"],
    contentSuggestions: {
      "@coherencedaddy": ["idea 1", "idea 2", "idea 3", "idea 4 (should be dropped, max 3)"],
    },
    funnelSuggestions: ["Re-run the ROOM keyword funnel — highest lead count last week"],
    inspirationReview: [{ url: "https://instagram.com/p/abc", comment: "Great hook, steal the format" }],
    llmVisibility: "Brand-mention monitoring isn't wired up yet.",
    summary: ["1", "2", "3", "4", "5"],
  };

  it("parses a strict-JSON response and normalizes every field", () => {
    const result = parseBriefResponse(JSON.stringify(validPayload));
    expect(result.ok).toBe(true);
    expect(result.sections.whatWorked).toEqual(validPayload.whatWorked);
    expect(result.sections.underutilized).toEqual(validPayload.underutilized);
    // contentSuggestions values are capped to 3 ideas.
    expect(result.sections.contentSuggestions).toEqual({
      "@coherencedaddy": ["idea 1", "idea 2", "idea 3"],
    });
    expect(result.sections.inspirationReview).toEqual(validPayload.inspirationReview);
    expect(result.sections.summary).toEqual(validPayload.summary);
  });

  it("extracts JSON out of a ```json fenced block despite instructions to skip fences", () => {
    const raw = "Sure, here's the brief:\n```json\n" + JSON.stringify(validPayload) + "\n```\nHope that helps!";
    const result = parseBriefResponse(raw);
    expect(result.ok).toBe(true);
    expect(result.sections.whatWorked).toEqual(validPayload.whatWorked);
  });

  it("falls back gracefully on invalid JSON — never throws, keeps the raw text", () => {
    const raw = "I'm sorry, I can't produce JSON right now, here's a summary instead...";
    const result = parseBriefResponse(raw);
    expect(result.ok).toBe(false);
    expect(result.sections.fallback).toMatchObject({ rawText: raw });
    expect((result.sections.fallback as { parseError: string }).parseError).toBeTruthy();
  });

  it("falls back when the top-level JSON value is not an object (e.g. an array)", () => {
    const result = parseBriefResponse(JSON.stringify(["not", "an", "object"]));
    expect(result.ok).toBe(false);
    expect(result.sections.fallback).toBeDefined();
  });

  it("caps the fallback raw text so a runaway response can't bloat storage", () => {
    const huge = "not json ".repeat(10_000);
    const result = parseBriefResponse(huge);
    expect(result.ok).toBe(false);
    const rawText = (result.sections.fallback as { rawText: string }).rawText;
    expect(rawText.length).toBeLessThanOrEqual(4000);
  });

  it("coerces wrong-typed fields to safe empty defaults instead of crashing", () => {
    const malformed = {
      whatWorked: "not an array",
      underutilized: null,
      contentSuggestions: "not an object",
      funnelSuggestions: 42,
      inspirationReview: [{ url: "https://x.test", comment: 123 }, { url: 5, comment: "ok" }, "garbage"],
      llmVisibility: 7,
      summary: [],
    };
    const result = parseBriefResponse(JSON.stringify(malformed));
    expect(result.ok).toBe(true);
    expect(result.sections.whatWorked).toEqual([]);
    expect(result.sections.underutilized).toEqual([]);
    expect(result.sections.contentSuggestions).toEqual({});
    expect(result.sections.funnelSuggestions).toEqual([]);
    // Every entry with a non-string url or non-string comment is dropped.
    expect(result.sections.inspirationReview).toEqual([]);
    expect(result.sections.llmVisibility).toBe("");
    expect(result.sections.summary).toEqual([]);
  });

  it("drops inspirationReview entries whose url is not http(s), even though comment/url are both strings", () => {
    // Guards against prompt-injected model output emitting a javascript:/data:
    // URI — the insert-time validateInspirationUrl() guard on the original
    // pasted link doesn't cover this re-entry point via LLM output.
    const withBadUrl = {
      ...validPayload,
      inspirationReview: [
        { url: "javascript:alert(document.cookie)", comment: "malicious" },
        { url: "data:text/html,<script>alert(1)</script>", comment: "also malicious" },
        { url: "https://instagram.com/p/abc", comment: "fine" },
      ],
    };
    const result = parseBriefResponse(JSON.stringify(withBadUrl));
    expect(result.ok).toBe(true);
    expect(result.sections.inspirationReview).toEqual([
      { url: "https://instagram.com/p/abc", comment: "fine" },
    ]);
  });
});

describe("validateInspirationUrl", () => {
  it("accepts http and https URLs", () => {
    expect(validateInspirationUrl("https://instagram.com/p/abc123")).toBe(true);
    expect(validateInspirationUrl("http://example.com")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateInspirationUrl("  https://instagram.com/p/abc123  ")).toBe(true);
  });

  it("rejects non-string, empty, and whitespace-only input", () => {
    expect(validateInspirationUrl(undefined)).toBe(false);
    expect(validateInspirationUrl(null)).toBe(false);
    expect(validateInspirationUrl(42)).toBe(false);
    expect(validateInspirationUrl("")).toBe(false);
    expect(validateInspirationUrl("   ")).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateInspirationUrl("javascript:alert(1)")).toBe(false);
    expect(validateInspirationUrl("ftp://example.com/file")).toBe(false);
    expect(validateInspirationUrl("mailto:a@b.test")).toBe(false);
  });

  it("rejects unparseable strings", () => {
    expect(validateInspirationUrl("not a url at all")).toBe(false);
  });
});
