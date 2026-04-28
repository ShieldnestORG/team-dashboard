import { describe, expect, it } from "vitest";
import {
  looksLikeNonEntity,
  NON_ENTITY_PATTERNS,
} from "../services/relationship-extractor.ts";

describe("looksLikeNonEntity", () => {
  // --- Should be rejected (true) ---

  it("rejects node-version shorthand like node24", () => {
    expect(looksLikeNonEntity("node24")).toBe(true);
  });

  it("rejects v-prefixed semver like v3.0.1", () => {
    expect(looksLikeNonEntity("v3.0.1")).toBe(true);
  });

  it("rejects v-prefixed semver like v0.5.0", () => {
    expect(looksLikeNonEntity("v0.5.0")).toBe(true);
  });

  it("rejects bare semver like 1.2.3", () => {
    expect(looksLikeNonEntity("1.2.3")).toBe(true);
  });

  it("rejects 16-char hex commit SHAs", () => {
    expect(looksLikeNonEntity("8a7f3d2b9c1e4f5a")).toBe(true);
  });

  it("rejects 7-char short SHAs", () => {
    expect(looksLikeNonEntity("8a7f3d2")).toBe(true);
  });

  it("rejects file extensions like .json", () => {
    expect(looksLikeNonEntity(".json")).toBe(true);
  });

  it("rejects sub-3-char strings like 'xx'", () => {
    expect(looksLikeNonEntity("xx")).toBe(true);
  });

  // --- Should be accepted (false) ---

  it("accepts real package names like aws-sdk-go-v2", () => {
    expect(looksLikeNonEntity("aws-sdk-go-v2")).toBe(false);
  });

  it("accepts display names like 'Argo CD'", () => {
    expect(looksLikeNonEntity("Argo CD")).toBe(false);
  });

  it("accepts 'Stripe'", () => {
    expect(looksLikeNonEntity("Stripe")).toBe(false);
  });

  it("accepts multi-word entities like 'Cosmos SDK'", () => {
    expect(looksLikeNonEntity("Cosmos SDK")).toBe(false);
  });
});

describe("NON_ENTITY_PATTERNS", () => {
  it("exports a non-empty array of regexes", () => {
    expect(Array.isArray(NON_ENTITY_PATTERNS)).toBe(true);
    expect(NON_ENTITY_PATTERNS.length).toBeGreaterThan(0);
    for (const p of NON_ENTITY_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});
