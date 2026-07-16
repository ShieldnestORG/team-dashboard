// ---------------------------------------------------------------------------
// provider-alerts — failure classification + daily dedup.
// The classifier is what turns the raw 400/401/429 the 2026-07 outage hid into
// a routed alert type. Locks in the Anthropic cap body string specifically.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyProviderFailure,
  noteProviderFailure,
  _resetProviderAlertDedup,
} from "./provider-alerts.js";

// sendAlert is fire-and-forget inside noteProviderFailure; spy so the dedup
// assertions can count calls without sending real email.
vi.mock("./alerting.js", () => ({
  sendAlert: vi.fn(async () => {}),
}));
import { sendAlert } from "./alerting.js";

afterEach(() => {
  _resetProviderAlertDedup();
  vi.clearAllMocks();
});

describe("classifyProviderFailure", () => {
  it("classifies the real Anthropic monthly-cap 400 body as 'capped'", () => {
    const body =
      '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-08-01 at 00:00 UTC."}}';
    expect(classifyProviderFailure(400, body)).toBe("capped");
  });

  it("classifies a low-credit 400 as 'capped'", () => {
    expect(classifyProviderFailure(400, "Your credit balance is too low")).toBe("capped");
  });

  it("maps statuses without cap signals correctly", () => {
    expect(classifyProviderFailure(401, "")).toBe("unauthorized");
    expect(classifyProviderFailure(403, "forbidden")).toBe("unauthorized");
    expect(classifyProviderFailure(402, "")).toBe("capped");
    expect(classifyProviderFailure(429, "rate limit exceeded")).toBe("rate_limited");
    expect(classifyProviderFailure(500, "boom")).toBe("server_error");
    expect(classifyProviderFailure(400, "invalid model id")).toBe("bad_request");
    expect(classifyProviderFailure(null, "")).toBe("unreachable");
  });
});

describe("noteProviderFailure daily dedup", () => {
  it("alerts once per provider+class+day, but re-alerts for a different provider", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    noteProviderFailure({ provider: "anthropic", service: "agent-runner", status: 400, bodyText: "usage limit reached", now });
    noteProviderFailure({ provider: "anthropic", service: "seo-engine", status: 400, bodyText: "usage limit reached", now });
    expect(sendAlert).toHaveBeenCalledTimes(1); // same provider+class+day → deduped

    noteProviderFailure({ provider: "xai", service: "watchtower:grok", status: 429, bodyText: "slow down", now });
    expect(sendAlert).toHaveBeenCalledTimes(2); // different provider → separate alert
  });

  it("routes the alert type by class", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    noteProviderFailure({ provider: "anthropic", service: "s", status: 401, now });
    expect(sendAlert).toHaveBeenCalledWith("provider_unauthorized", expect.any(String), expect.any(String));
  });
});
