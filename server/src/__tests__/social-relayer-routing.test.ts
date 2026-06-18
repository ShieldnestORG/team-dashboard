// ---------------------------------------------------------------------------
// Unit tests for resolvePublisher — the Zernio-vs-native routing decision.
//
// Accounts connected through Zernio (oauthRef "zernio:<id>") must publish via the
// Zernio publisher for EVERY platform (IG/TikTok/YouTube/X) — one Zernio
// per-account key speaks all of them, so no per-platform OAuth lives in this app.
// Non-Zernio accounts fall back to the native per-platform publisher.
//
// Tests the REAL registry (no mocks) so the routing decision is exercised.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { getPublisher, resolvePublisher } from "../services/platform-publishers/index.js";

describe("resolvePublisher — Zernio-vs-native routing", () => {
  it("routes ANY zernio: account through the Zernio publisher, every platform", () => {
    for (const platform of ["instagram", "tiktok", "youtube", "x", "twitter"]) {
      const p = resolvePublisher(platform, "zernio:acct_1");
      expect(p, `platform=${platform}`).toBeDefined();
      // The Zernio publisher's name is "instagram" (it is the working publish path).
      expect(p!.name, `platform=${platform}`).toBe("instagram");
      // It can publish text-first posts (the relayer path).
      expect(typeof p!.publishText, `platform=${platform}`).toBe("function");
    }
  });

  it("falls back to the native publisher for non-Zernio accounts", () => {
    // tiktok native publisher answers to platform string "tiktok".
    expect(resolvePublisher("tiktok", null)).toBe(getPublisher("tiktok"));
    expect(resolvePublisher("tiktok", undefined)?.name).toBe("tiktok");
    // A plain http oauthRef is NOT a zernio account → native path.
    expect(resolvePublisher("tiktok", "https://example.com")?.name).toBe("tiktok");
  });

  it("documents the native gap: non-Zernio youtube/x have no matching publisher", () => {
    // Native youtube/x publishers answer to "youtube_shorts"/"twitter_video",
    // not the "youtube"/"x" platform strings — so without Zernio they don't route.
    expect(resolvePublisher("youtube", null)).toBeUndefined();
    expect(resolvePublisher("x", null)).toBeUndefined();
  });
});
