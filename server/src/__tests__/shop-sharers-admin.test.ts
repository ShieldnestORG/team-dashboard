/**
 * Unit tests for the admin-created affiliate-link helpers in the shop-sharers
 * service. We cover the pure, side-effect-free exports:
 *   - slugifyReferralCode: normalizes an admin-supplied vanity code
 *   - shareUrlFor: builds the public ?ref= link
 *
 * The DB-touching createForAdmin path is exercised at the route level; here we
 * lock the slug contract that the vanity links depend on (e.g. "Remy" → remy).
 */

import { describe, expect, it } from "vitest";
import {
  slugifyReferralCode,
  shareUrlFor,
  affiliateLinkFor,
} from "../services/shop-sharers.ts";

describe("slugifyReferralCode", () => {
  it("lowercases and trims a simple handle", () => {
    expect(slugifyReferralCode("Remy")).toBe("remy");
    expect(slugifyReferralCode("  Bri  ")).toBe("bri");
  });

  it("collapses runs of non-alphanumerics to a single hyphen", () => {
    expect(slugifyReferralCode("Solene Marie")).toBe("solene-marie");
    expect(slugifyReferralCode("mami___x")).toBe("mami-x");
    expect(slugifyReferralCode("a@@@b")).toBe("a-b");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyReferralCode("--remy--")).toBe("remy");
    expect(slugifyReferralCode("!!bri!!")).toBe("bri");
  });

  it("returns empty string when nothing usable remains", () => {
    expect(slugifyReferralCode("")).toBe("");
    expect(slugifyReferralCode("   ")).toBe("");
    expect(slugifyReferralCode("@#$%")).toBe("");
  });

  it("caps length at 32 chars", () => {
    const long = "a".repeat(50);
    expect(slugifyReferralCode(long)).toHaveLength(32);
  });

  it("preserves digits", () => {
    expect(slugifyReferralCode("Remy2026")).toBe("remy2026");
  });
});

describe("shareUrlFor", () => {
  it("builds the default shop referral link", () => {
    expect(shareUrlFor("remy")).toBe(
      "https://shop.coherencedaddy.com/?ref=remy",
    );
  });

  it("url-encodes the code", () => {
    expect(shareUrlFor("a b")).toContain("ref=a%20b");
  });
});

describe("affiliateLinkFor", () => {
  it("builds a base attributed link on the affiliate domain", () => {
    expect(affiliateLinkFor("remy")).toBe("https://outrizzd.com/?ref=remy");
  });

  it("deep-links to a single product when given a productId", () => {
    expect(affiliateLinkFor("remy", "abc123")).toBe(
      "https://outrizzd.com/p/abc123?ref=remy",
    );
  });

  it("ignores blank productId and falls back to the base link", () => {
    expect(affiliateLinkFor("bri", "   ")).toBe(
      "https://outrizzd.com/?ref=bri",
    );
  });

  it("url-encodes both the code and the product id", () => {
    const url = affiliateLinkFor("a b", "p/d");
    expect(url).toContain("/p/p%2Fd");
    expect(url).toContain("?ref=a%20b");
  });
});
