// ---------------------------------------------------------------------------
// Google Ads offline conversion uploader tests.
//
// The uploader is ENV-GATED and must be safe in every degraded state:
//   1. unconfigured → logs instead of sending, returns {sent:false}
//   2. configured but no click id (organic purchase) → no network, {sent:false}
//   3. configured + gclid → OAuth token refresh, then uploadClickConversions
//      with the right resource name, orderId, value (dollars, not cents)
//   4. exactly ONE click id per conversion — gclid preferred over w/gbraid
//   5. partialFailureError (duplicate orderId on webhook retry) → {sent:false},
//      never a throw
//   6. universityConversionFromSession extracts click ids + amount from the
//      session metadata stamped by the checkout route
//
// fetch is stubbed — no network is touched.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  googleAdsConfigured,
  uploadUniversityPurchaseConversion,
  universityConversionFromSession,
} from "../services/google-ads-conversions.js";

const ENV_KEYS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_UNIVERSITY_CONVERSION_ACTION_ID",
  "GOOGLE_ADS_API_VERSION",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function configureAll(): void {
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_OAUTH_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_ADS_CUSTOMER_ID = "123-456-7890"; // UI format on purpose
  process.env.GOOGLE_ADS_UNIVERSITY_CONVERSION_ACTION_ID = "987654321";
}

const fetchSpy = vi.fn();

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("googleAdsConfigured", () => {
  it("is false until every required var is set, true after", () => {
    expect(googleAdsConfigured()).toBe(false);
    configureAll();
    expect(googleAdsConfigured()).toBe(true);
    delete process.env.GOOGLE_ADS_UNIVERSITY_CONVERSION_ACTION_ID;
    expect(googleAdsConfigured()).toBe(false);
  });
});

describe("uploadUniversityPurchaseConversion — degraded states", () => {
  it("unconfigured → {sent:false, unconfigured} and NO network call", async () => {
    const result = await uploadUniversityPurchaseConversion({
      gclid: "abc123",
      orderId: "cs_test_1",
      valueCents: 5000,
    });
    expect(result).toEqual({ sent: false, reason: "unconfigured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("configured but no click id (organic) → {sent:false, no_click_id}, no network", async () => {
    configureAll();
    const result = await uploadUniversityPurchaseConversion({
      orderId: "cs_test_2",
      valueCents: 5000,
    });
    expect(result).toEqual({ sent: false, reason: "no_click_id" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unconfigured AND no click id → no_click_id (organic purchases never log a 'would upload' payload)", async () => {
    const result = await uploadUniversityPurchaseConversion({
      orderId: "cs_test_2b",
      valueCents: 5000,
    });
    expect(result).toEqual({ sent: false, reason: "no_click_id" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("uploadUniversityPurchaseConversion — configured upload", () => {
  it("refreshes an OAuth token then uploads the click conversion", async () => {
    configureAll();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { results: [{}] }));

    const result = await uploadUniversityPurchaseConversion({
      gclid: "gclid-xyz",
      orderId: "cs_test_3",
      valueCents: 5000,
      occurredAt: new Date("2026-07-15T12:34:56Z"),
    });

    expect(result).toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Call 1 — token refresh with the refresh_token grant.
    const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(String(tokenInit.body)).toContain("grant_type=refresh_token");

    // Call 2 — uploadClickConversions on the dash-stripped customer id.
    const [uploadUrl, uploadInit] = fetchSpy.mock.calls[1]! as [
      string,
      RequestInit,
    ];
    expect(uploadUrl).toBe(
      "https://googleads.googleapis.com/v21/customers/1234567890:uploadClickConversions",
    );
    const headers = uploadInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer at-1");
    expect(headers["developer-token"]).toBe("dev-token");
    expect(headers["login-customer-id"]).toBeUndefined(); // not set

    const payload = JSON.parse(String(uploadInit.body)) as {
      partialFailure: boolean;
      conversions: Array<Record<string, unknown>>;
    };
    expect(payload.partialFailure).toBe(true);
    expect(payload.conversions).toHaveLength(1);
    const conv = payload.conversions[0]!;
    expect(conv.gclid).toBe("gclid-xyz");
    expect(conv.conversionAction).toBe(
      "customers/1234567890/conversionActions/987654321",
    );
    expect(conv.orderId).toBe("cs_test_3");
    expect(conv.conversionValue).toBe(50); // dollars, never cents
    expect(conv.currencyCode).toBe("USD");
    expect(conv.conversionDateTime).toBe("2026-07-15 12:34:56+00:00");
  });

  it("sends exactly one click id — gclid wins over wbraid/gbraid", async () => {
    configureAll();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
      .mockResolvedValueOnce(jsonResponse(200, { results: [{}] }));

    await uploadUniversityPurchaseConversion({
      gclid: "g-1",
      wbraid: "w-1",
      gbraid: "gb-1",
      orderId: "cs_test_4",
      valueCents: null,
    });

    const conv = (
      JSON.parse(String((fetchSpy.mock.calls[1]! as [string, RequestInit])[1].body)) as {
        conversions: Array<Record<string, unknown>>;
      }
    ).conversions[0]!;
    expect(conv.gclid).toBe("g-1");
    expect(conv.wbraid).toBeUndefined();
    expect(conv.gbraid).toBeUndefined();
    // No value known → no conversionValue/currencyCode keys at all.
    expect(conv.conversionValue).toBeUndefined();
    expect(conv.currencyCode).toBeUndefined();
  });

  it("falls back to wbraid when gclid is absent", async () => {
    configureAll();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
      .mockResolvedValueOnce(jsonResponse(200, { results: [{}] }));

    await uploadUniversityPurchaseConversion({
      wbraid: "w-only",
      orderId: "cs_test_5",
      valueCents: 7900,
    });

    const conv = (
      JSON.parse(String((fetchSpy.mock.calls[1]! as [string, RequestInit])[1].body)) as {
        conversions: Array<Record<string, unknown>>;
      }
    ).conversions[0]!;
    expect(conv.wbraid).toBe("w-only");
    expect(conv.gclid).toBeUndefined();
  });

  it("sends login-customer-id when an MCC id is configured", async () => {
    configureAll();
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "111-222-3333";
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
      .mockResolvedValueOnce(jsonResponse(200, { results: [{}] }));

    await uploadUniversityPurchaseConversion({
      gclid: "g",
      orderId: "cs_test_6",
      valueCents: 5000,
    });

    const headers = (fetchSpy.mock.calls[1]! as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers["login-customer-id"]).toBe("1112223333");
  });

  it("partialFailureError (duplicate orderId on retry) → {sent:false, api_error}, no throw", async () => {
    configureAll();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "at" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          partialFailureError: { message: "CLICK_CONVERSION_ALREADY_EXISTS" },
        }),
      );

    const result = await uploadUniversityPurchaseConversion({
      gclid: "g",
      orderId: "cs_test_7",
      valueCents: 5000,
    });
    expect(result).toEqual({
      sent: false,
      reason: "api_error",
      detail: "CLICK_CONVERSION_ALREADY_EXISTS",
    });
  });

  it("token-refresh failure → {sent:false, api_error}, no throw", async () => {
    configureAll();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(400, { error: "invalid_grant", error_description: "expired" }),
    );

    const result = await uploadUniversityPurchaseConversion({
      gclid: "g",
      orderId: "cs_test_8",
      valueCents: 5000,
    });
    expect(result.sent).toBe(false);
    if (!result.sent) expect(result.reason).toBe("api_error");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // never reached the upload call
  });
});

describe("universityConversionFromSession", () => {
  it("extracts click ids + billed amount from the metadata the checkout route stamps", () => {
    const conv = universityConversionFromSession({
      id: "cs_live_9",
      metadata: {
        product: "university",
        plan: "university_monthly",
        unit_amount_cents: "5000",
        gclid: "g-123",
        wbraid: "w-456",
      },
    });
    expect(conv).toEqual({
      gclid: "g-123",
      wbraid: "w-456",
      gbraid: null,
      orderId: "cs_live_9",
      valueCents: 5000,
    });
  });

  it("null-safe on missing metadata / malformed amount", () => {
    const conv = universityConversionFromSession({
      id: "cs_live_10",
      metadata: { unit_amount_cents: "not-a-number" },
    });
    expect(conv).toEqual({
      gclid: null,
      wbraid: null,
      gbraid: null,
      orderId: "cs_live_10",
      valueCents: null,
    });
  });
});
