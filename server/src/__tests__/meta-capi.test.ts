import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Meta CAPI client tests.
//
// The logger pulls in pino + a file-transport chain, so we stub it to keep the
// unit test isolated and quiet. `fetch` is replaced with a vi mock so the suite
// never touches the network — we assert the request URL + payload shape and the
// no-op behaviour when env vars are unset.
// ---------------------------------------------------------------------------

vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sendPurchaseEvent, isEnabled } from "../services/meta-capi.js";

const PIXEL = "1234567890";
const TOKEN = "test-capi-token";

const ENV_KEYS = ["META_PIXEL_ID", "META_CAPI_ACCESS_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

function fetchMock() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace_abc" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("meta-capi — isEnabled", () => {
  it("is false when either env var is unset", () => {
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_ACCESS_TOKEN;
    expect(isEnabled()).toBe(false);

    process.env.META_PIXEL_ID = PIXEL;
    delete process.env.META_CAPI_ACCESS_TOKEN;
    expect(isEnabled()).toBe(false);

    delete process.env.META_PIXEL_ID;
    process.env.META_CAPI_ACCESS_TOKEN = TOKEN;
    expect(isEnabled()).toBe(false);
  });

  it("is true when both env vars are set", () => {
    process.env.META_PIXEL_ID = PIXEL;
    process.env.META_CAPI_ACCESS_TOKEN = TOKEN;
    expect(isEnabled()).toBe(true);
  });
});

describe("meta-capi — sendPurchaseEvent", () => {
  it("no-ops (skipped) and never calls fetch when env is unset", async () => {
    delete process.env.META_PIXEL_ID;
    delete process.env.META_CAPI_ACCESS_TOKEN;
    const fetchSpy = fetchMock();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendPurchaseEvent({
      eventId: "evt_1",
      email: "user@example.com",
      value: 50,
      currency: "USD",
    });

    expect(result).toEqual({ skipped: true, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a correctly-shaped Purchase payload with hashed email + event_id passthrough", async () => {
    process.env.META_PIXEL_ID = PIXEL;
    process.env.META_CAPI_ACCESS_TOKEN = TOKEN;
    const fetchSpy = fetchMock();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendPurchaseEvent({
      eventId: "evt_dedup_42",
      email: "  User@Example.COM ", // mixed-case + whitespace → must normalize
      value: 50,
      currency: "USD",
      fbc: "fb.1.123.abc",
      fbp: "fb.1.456.def",
      eventTime: 1_700_000_000,
      eventSourceUrl: "https://example.com/checkout",
    });

    expect(result).toEqual({
      sent: true,
      eventId: "evt_dedup_42",
      eventsReceived: 1,
      fbtraceId: "trace_abc",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];

    // Endpoint: graph.facebook.com/<PIXEL_ID>/events
    expect(url).toContain(`/${PIXEL}/events`);
    expect(url.startsWith("https://graph.facebook.com/")).toBe(true);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const sent = JSON.parse(init.body as string);

    // access_token travels in the body, not the URL.
    expect(sent.access_token).toBe(TOKEN);
    expect(url).not.toContain(TOKEN);

    expect(sent.data).toHaveLength(1);
    const event = sent.data[0];

    expect(event.event_name).toBe("Purchase");
    expect(event.event_time).toBe(1_700_000_000);
    expect(event.event_id).toBe("evt_dedup_42"); // caller event_id passthrough
    expect(event.action_source).toBe("website");
    expect(event.event_source_url).toBe("https://example.com/checkout");
    expect(event.custom_data).toEqual({ value: 50, currency: "USD" });

    // Email must be SHA-256 of the trimmed + lowercased value.
    const expectedHash = createHash("sha256")
      .update("user@example.com")
      .digest("hex");
    expect(event.user_data.em).toEqual([expectedHash]);
    // The raw email must never appear anywhere in the payload.
    expect(init.body as string).not.toContain("User@Example.COM");
    expect(init.body as string).not.toContain("user@example.com");

    // fbc / fbp are sent RAW (un-hashed).
    expect(event.user_data.fbc).toBe("fb.1.123.abc");
    expect(event.user_data.fbp).toBe("fb.1.456.def");
  });

  it("omits fbc/fbp and event_source_url when not supplied", async () => {
    process.env.META_PIXEL_ID = PIXEL;
    process.env.META_CAPI_ACCESS_TOKEN = TOKEN;
    const fetchSpy = fetchMock();
    vi.stubGlobal("fetch", fetchSpy);

    await sendPurchaseEvent({
      eventId: "evt_2",
      email: "a@b.com",
      value: 12.5,
      currency: "EUR",
    });

    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    const event = JSON.parse(init.body as string).data[0];
    expect(event.user_data.fbc).toBeUndefined();
    expect(event.user_data.fbp).toBeUndefined();
    expect(event.event_source_url).toBeUndefined();
    expect(Object.keys(event.user_data)).toEqual(["em"]);
  });

  it("returns { sent:false, error } on a non-OK response and never throws", async () => {
    process.env.META_PIXEL_ID = PIXEL;
    process.env.META_CAPI_ACCESS_TOKEN = TOKEN;
    const fetchSpy = vi.fn(async () =>
      new Response("bad token", { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendPurchaseEvent({
      eventId: "evt_3",
      email: "a@b.com",
      value: 1,
      currency: "USD",
    });

    expect(result).toMatchObject({ sent: false });
    if ("error" in result) expect(result.error).toContain("400");
  });

  it("returns { sent:false, error } when fetch rejects (network/timeout) and never throws", async () => {
    process.env.META_PIXEL_ID = PIXEL;
    process.env.META_CAPI_ACCESS_TOKEN = TOKEN;
    const fetchSpy = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendPurchaseEvent({
      eventId: "evt_4",
      email: "a@b.com",
      value: 1,
      currency: "USD",
    });

    expect(result).toEqual({ sent: false, error: "network down" });
  });
});
