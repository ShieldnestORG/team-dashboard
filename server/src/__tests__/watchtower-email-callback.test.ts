// ---------------------------------------------------------------------------
// Watchtower email-callback URL-builder tests (Stream F).
//
// These are pure-function tests; no DB and no network. They verify that
// the digest payload's UTM-tagged dashboard URL and manage-subscription
// URL are well-formed, embed the run id, and degrade gracefully when
// `PORTAL_BASE_URL` is unset (falls back to the public app domain — same
// convention as `customer-portal.ts:portalBaseUrl()`).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDashboardRunUrl,
  buildManageSubscriptionUrl,
} from "../services/watchtower-email-callback.js";

const originalEnv = process.env.PORTAL_BASE_URL;

describe("watchtower-email-callback URL builders", () => {
  beforeEach(() => {
    delete process.env.PORTAL_BASE_URL;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PORTAL_BASE_URL;
    else process.env.PORTAL_BASE_URL = originalEnv;
  });

  describe("buildDashboardRunUrl", () => {
    it("embeds the run id and the full UTM trio when PORTAL_BASE_URL is set", () => {
      process.env.PORTAL_BASE_URL = "https://portal.example.com";
      const runId = "11111111-2222-3333-4444-555555555555";

      const url = buildDashboardRunUrl(runId);
      const u = new URL(url);

      expect(u.origin).toBe("https://portal.example.com");
      expect(u.pathname).toBe("/watchtower");
      expect(u.searchParams.get("run")).toBe(runId);
      expect(u.searchParams.get("utm_source")).toBe("watchtower-digest");
      expect(u.searchParams.get("utm_medium")).toBe("email");
      expect(u.searchParams.get("utm_campaign")).toBe("weekly-digest");
    });

    it("strips trailing slash on PORTAL_BASE_URL so the path is not doubled", () => {
      process.env.PORTAL_BASE_URL = "https://portal.example.com/";
      const url = buildDashboardRunUrl("abc");
      expect(url.startsWith("https://portal.example.com/watchtower?")).toBe(
        true,
      );
      expect(url).not.toContain("//watchtower");
    });

    it("falls back to the public app domain when PORTAL_BASE_URL is unset (does not throw)", () => {
      const url = buildDashboardRunUrl("run-xyz");
      const u = new URL(url);
      expect(u.origin).toBe("https://app.coherencedaddy.com");
      expect(u.pathname).toBe("/watchtower");
      expect(u.searchParams.get("run")).toBe("run-xyz");
    });
  });

  describe("buildManageSubscriptionUrl", () => {
    it("points at /billing with the manage-subscription UTM campaign", () => {
      process.env.PORTAL_BASE_URL = "https://portal.example.com";
      const url = buildManageSubscriptionUrl();
      const u = new URL(url);

      expect(u.origin).toBe("https://portal.example.com");
      expect(u.pathname).toBe("/billing");
      expect(u.searchParams.get("utm_source")).toBe("watchtower-digest");
      expect(u.searchParams.get("utm_medium")).toBe("email");
      expect(u.searchParams.get("utm_campaign")).toBe("manage-subscription");
    });

    it("falls back to the public app domain when PORTAL_BASE_URL is unset", () => {
      const url = buildManageSubscriptionUrl();
      const u = new URL(url);
      expect(u.origin).toBe("https://app.coherencedaddy.com");
      expect(u.pathname).toBe("/billing");
    });
  });
});
