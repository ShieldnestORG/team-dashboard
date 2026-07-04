import { describe, expect, it } from "vitest";
import {
  statusBadge,
  statusBadgeDefault,
  platformBadge,
  platformBadgeDefault,
  PLATFORM_META,
  PLATFORM_ORDER,
  normalizePlatform,
} from "./status-colors";

// Every real status enum value used by SocialPost / LibraryFunnel /
// SocialAccount / InspirationItem must resolve to a real token, never fall
// through to the generic gray default — that's exactly the "everything is
// monochrome" complaint this map exists to fix.
const SOCIAL_POST_STATUSES = ["scheduled", "pending_approval", "publishing", "posted", "failed", "canceled"];
const FUNNEL_STATUSES = ["draft", "ready", "live", "rejected", "retired"];
const SOCIAL_ACCOUNT_STATUSES = ["active", "dormant", "paused", "deprecated"];
const INSPIRATION_STATUSES = ["new", "reviewed", "archived"];

// "canceled" and "archived" are deliberately mapped to the same neutral
// gray as the default treatment (a canceled/archived item IS meant to read
// as inactive) — the thing worth testing there is that the key exists in
// the map at all, not that its string differs from the default.
const INTENTIONALLY_NEUTRAL = new Set(["canceled", "archived"]);

describe("statusBadge — no fallthrough gray for known enum values", () => {
  for (const status of [
    ...SOCIAL_POST_STATUSES,
    ...FUNNEL_STATUSES,
    ...SOCIAL_ACCOUNT_STATUSES,
    ...INSPIRATION_STATUSES,
  ]) {
    it(`has a token explicitly registered for "${status}"`, () => {
      expect(statusBadge[status]).toBeDefined();
      if (!INTENTIONALLY_NEUTRAL.has(status)) {
        expect(statusBadge[status]).not.toBe(statusBadgeDefault);
      }
    });
  }

  it("one-L canceled (socials) and two-L cancelled (issues) both resolve", () => {
    expect(statusBadge.canceled).toBeDefined();
    expect(statusBadge.cancelled).toBeDefined();
  });

  it("falls back to statusBadgeDefault for a genuinely unknown status", () => {
    expect(statusBadge["not-a-real-status"]).toBeUndefined();
  });
});

describe("platformBadge + PLATFORM_META — every canonical platform has a color and an icon", () => {
  for (const platform of PLATFORM_ORDER) {
    it(`"${platform}" has a color token and metadata`, () => {
      expect(platformBadge[platform]).toBeDefined();
      expect(platformBadge[platform]).not.toBe(platformBadgeDefault);
      expect(PLATFORM_META[platform]).toBeDefined();
      expect(PLATFORM_META[platform]?.icon).toBeTruthy();
    });
  }
});

describe("normalizePlatform", () => {
  it("collapses legacy twitter spellings onto x", () => {
    expect(normalizePlatform("twitter")).toBe("x");
    expect(normalizePlatform("twitter_video")).toBe("x");
    expect(normalizePlatform("Twitter")).toBe("x");
  });

  it("collapses instagram variants", () => {
    expect(normalizePlatform("instagram_reels")).toBe("instagram");
    expect(normalizePlatform("ig")).toBe("instagram");
  });

  it("collapses youtube shorts", () => {
    expect(normalizePlatform("youtube_shorts")).toBe("youtube");
  });

  it("passes through already-canonical platforms unchanged", () => {
    expect(normalizePlatform("bluesky")).toBe("bluesky");
    expect(normalizePlatform("linkedin")).toBe("linkedin");
  });
});
