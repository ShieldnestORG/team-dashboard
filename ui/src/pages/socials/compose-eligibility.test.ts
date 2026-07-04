import { describe, expect, it } from "vitest";
import { checkComposeForPlatform } from "@paperclipai/shared";
import { isAccountComposable, isExcludedForNonZernioRouting } from "./compose-eligibility";
import type { SocialAccount } from "../../api/socials";

function account(overrides: Partial<SocialAccount> = {}): Pick<SocialAccount, "status" | "platform" | "routing"> {
  return { status: "active", platform: "bluesky", routing: undefined, ...overrides };
}

describe("isAccountComposable", () => {
  it("allows an active Bluesky account with no routing info", () => {
    expect(isAccountComposable(account({ platform: "bluesky" }))).toBe(true);
  });

  it("rejects a dormant/paused account regardless of platform", () => {
    expect(isAccountComposable(account({ platform: "bluesky", status: "paused" }))).toBe(false);
  });

  it("rejects a platform Compose doesn't know (e.g. youtube)", () => {
    expect(isAccountComposable(account({ platform: "youtube", routing: "zernio" }))).toBe(false);
  });

  it("rejects a Zernio-media-platform account that ISN'T Zernio-routed", () => {
    expect(isAccountComposable(account({ platform: "instagram", routing: "native" }))).toBe(false);
  });

  it("allows a Zernio-routed Instagram account", () => {
    expect(isAccountComposable(account({ platform: "instagram", routing: "zernio" }))).toBe(true);
  });

  it("allows a Zernio-routed TikTok account", () => {
    expect(isAccountComposable(account({ platform: "tiktok", routing: "zernio" }))).toBe(true);
  });
});

describe("isExcludedForNonZernioRouting", () => {
  it("flags an active, non-Zernio-routed Instagram account", () => {
    expect(isExcludedForNonZernioRouting(account({ platform: "instagram", routing: "native" }))).toBe(true);
  });

  it("flags an active TikTok account with no routing info at all", () => {
    expect(isExcludedForNonZernioRouting(account({ platform: "tiktok", routing: undefined }))).toBe(true);
  });

  it("does not flag a Zernio-routed Instagram account (it's already composable)", () => {
    expect(isExcludedForNonZernioRouting(account({ platform: "instagram", routing: "zernio" }))).toBe(false);
  });

  it("does not flag a paused non-Zernio Instagram account", () => {
    expect(
      isExcludedForNonZernioRouting(account({ platform: "instagram", status: "paused", routing: "native" })),
    ).toBe(false);
  });

  it("does not flag Bluesky (routing is irrelevant there)", () => {
    expect(isExcludedForNonZernioRouting(account({ platform: "bluesky", routing: "native" }))).toBe(false);
  });

  it("does not flag a platform Compose doesn't know", () => {
    expect(isExcludedForNonZernioRouting(account({ platform: "youtube", routing: "native" }))).toBe(false);
  });
});

describe("checkComposeForPlatform (re-exported shared guard, exercised from the UI side)", () => {
  it("blocks an Instagram post with no media", () => {
    const problem = checkComposeForPlatform({ platform: "instagram", textLength: 10, media: [] });
    expect(problem).toMatch(/photo or video/i);
  });

  it("allows an Instagram post once an image is attached", () => {
    const problem = checkComposeForPlatform({
      platform: "instagram",
      textLength: 10,
      media: [{ value: "obj-key.jpg", isVideo: false }],
    });
    expect(problem).toBeNull();
  });

  it("blocks a TikTok post whose only attachment is a photo", () => {
    const problem = checkComposeForPlatform({
      platform: "tiktok",
      textLength: 10,
      media: [{ value: "obj-key.jpg", isVideo: false }],
    });
    expect(problem).toMatch(/video/i);
  });

  it("blocks a caption over the platform's limit", () => {
    const problem = checkComposeForPlatform({
      platform: "bluesky",
      textLength: 301,
      media: [],
    });
    expect(problem).toMatch(/300/);
  });

  it("blocks more than the max attachment count", () => {
    const problem = checkComposeForPlatform({
      platform: "bluesky",
      textLength: 5,
      media: Array.from({ length: 5 }, (_, i) => ({ value: `${i}.jpg`, isVideo: false })),
    });
    expect(problem).toMatch(/at most 4/i);
  });
});
