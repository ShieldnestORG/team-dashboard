import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// The logger writes to disk/stdout on import; stub it so tests stay quiet and
// we can assert on the one-time "disabled" notice.
vi.mock("../middleware/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../middleware/logger.js";
import { isEnabled, sendCompletePaymentEvent } from "../services/tiktok-events.js";

const PIXEL = "C123PIXEL";
const TOKEN = "tok_secret_abc";
const EMAIL = "  Alice@Example.COM ";
const EXPECTED_EMAIL_HASH = createHash("sha256")
  .update(EMAIL.trim().toLowerCase())
  .digest("hex");

function enableEnv() {
  process.env.TIKTOK_PIXEL_ID = PIXEL;
  process.env.TIKTOK_EVENTS_TOKEN = TOKEN;
}

function disableEnv() {
  delete process.env.TIKTOK_PIXEL_ID;
  delete process.env.TIKTOK_EVENTS_TOKEN;
}

describe("tiktok-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    disableEnv();
  });

  // -------------------------------------------------------------------------
  // No-op behaviour (env unset)
  // -------------------------------------------------------------------------

  describe("when not configured", () => {
    beforeEach(() => {
      disableEnv();
    });

    it("isEnabled() is false when env vars are unset", () => {
      expect(isEnabled()).toBe(false);
    });

    it("isEnabled() is false when only the pixel id is set", () => {
      process.env.TIKTOK_PIXEL_ID = PIXEL;
      expect(isEnabled()).toBe(false);
    });

    it("isEnabled() is false when only the token is set", () => {
      process.env.TIKTOK_EVENTS_TOKEN = TOKEN;
      expect(isEnabled()).toBe(false);
    });

    it("no-ops (returns skipped) and never calls fetch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const result = await sendCompletePaymentEvent({
        eventId: "evt-1",
        email: EMAIL,
        value: 50,
        currency: "USD",
      });

      expect(result).toEqual({ skipped: true, reason: "not_configured" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not throw when unset", async () => {
      await expect(
        sendCompletePaymentEvent({
          eventId: "evt-2",
          email: EMAIL,
          value: 1,
          currency: "USD",
        }),
      ).resolves.toMatchObject({ skipped: true });
    });
  });

  // -------------------------------------------------------------------------
  // Enabled behaviour (env set) — payload + hashing
  // -------------------------------------------------------------------------

  describe("when configured", () => {
    beforeEach(() => {
      enableEnv();
    });

    it("isEnabled() is true when both env vars are set", () => {
      expect(isEnabled()).toBe(true);
    });

    it("sends a correctly-shaped CompletePayment payload with a hashed email and raw ttclid", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ code: 0, message: "OK", request_id: "req-xyz" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await sendCompletePaymentEvent({
        eventId: "evt-dedup-123",
        email: EMAIL,
        value: 49.99,
        currency: "USD",
        ttclid: "ttclid_RAW_value",
        contentType: "product",
        eventTime: 1_700_000_000,
      });

      expect(result).toEqual({
        sent: true,
        eventId: "evt-dedup-123",
        code: 0,
        requestId: "req-xyz",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];

      // Endpoint + version path
      expect(calledUrl).toBe(
        "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      );

      // Headers: Access-Token carries the events token, JSON content type
      expect(calledInit.method).toBe("POST");
      expect((calledInit.headers as Record<string, string>)["Access-Token"]).toBe(TOKEN);
      expect((calledInit.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );

      const body = JSON.parse(calledInit.body as string);

      // Top-level event source carries the pixel id
      expect(body.event_source).toBe("web");
      expect(body.event_source_id).toBe(PIXEL);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);

      const event = body.data[0];
      expect(event.event).toBe("CompletePayment");
      expect(event.event_id).toBe("evt-dedup-123");
      expect(event.event_time).toBe(1_700_000_000);

      // Email is SHA-256 hashed (lowercased + trimmed); ttclid sent RAW
      expect(event.user.email).toBe(EXPECTED_EMAIL_HASH);
      expect(event.user.email).not.toContain("@");
      expect(event.user.ttclid).toBe("ttclid_RAW_value");

      // Properties
      expect(event.properties).toEqual({
        value: 49.99,
        currency: "USD",
        content_type: "product",
      });
    });

    it("defaults content_type to 'product' and omits ttclid when not provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ code: 0 }), { status: 200 }),
      );

      await sendCompletePaymentEvent({
        eventId: "evt-no-ttclid",
        email: "bob@example.com",
        value: 10,
        currency: "EUR",
      });

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      const event = body.data[0];
      expect(event.properties.content_type).toBe("product");
      expect("ttclid" in event.user).toBe(false);
    });

    it("returns sent:false (does not throw) when fetch rejects", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

      const result = await sendCompletePaymentEvent({
        eventId: "evt-neterr",
        email: EMAIL,
        value: 5,
        currency: "USD",
      });

      expect(result).toEqual({ sent: false, error: "network down" });
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns sent:false on a non-OK HTTP status", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("bad request", { status: 400 }),
      );

      const result = await sendCompletePaymentEvent({
        eventId: "evt-400",
        email: EMAIL,
        value: 5,
        currency: "USD",
      });

      expect(result).toMatchObject({ sent: false });
      if ("error" in result) {
        expect(result.error).toContain("400");
      }
    });

    it("returns sent:false when the body code is non-zero (HTTP 200 logical failure)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ code: 40001, message: "invalid access token", request_id: "req-err" }),
          { status: 200 },
        ),
      );

      const result = await sendCompletePaymentEvent({
        eventId: "evt-code-fail",
        email: EMAIL,
        value: 5,
        currency: "USD",
      });

      expect(result).toMatchObject({ sent: false });
      if ("error" in result) {
        expect(result.error).toContain("40001");
      }
    });
  });
});
