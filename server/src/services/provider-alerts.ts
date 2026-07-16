// ---------------------------------------------------------------------------
// AI provider failure alerting — the "never fly blind again" choke-point.
//
// Background (2026-07-15 incident): the shared Anthropic account hit its monthly
// usage limit ~2026-07-07 and every LLM caller silently fell back to a scripted
// / non-LLM path (agent-runner/claude.ts: `if (!res.ok) return null`). No log,
// no alert — the outage was invisible for 8 days.
//
// This module classifies a provider failure from its HTTP status + error body
// and raises ONE loud, deduped alert (per provider + class + UTC day) through
// the existing sendAlert() path (critical → immediate owner email + alert_events
// row). Every LLM call site calls noteProviderFailure() in its error branch;
// it NEVER throws, so it can be dropped into any catch/!res.ok without changing
// behavior.
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger.js";
import { sendAlert } from "./alerting.js";

export type ProviderFailureClass =
  | "capped" // usage / credit / quota / billing limit reached
  | "unauthorized" // 401/403 — bad or missing key
  | "rate_limited" // 429 — throttled
  | "server_error" // 5xx — provider-side outage
  | "bad_request" // other 4xx — likely a request bug (e.g. invalid model id)
  | "unreachable"; // no HTTP response — network error / timeout

// Body-text signals that a 4xx is really a spend/quota wall rather than a
// malformed request. Providers word these differently, so match broadly.
const CAP_SIGNAL =
  /usage limit|credit balance|reached your|out of credit|insufficient|quota|billing|payment required|spend(ing)? limit/i;

/**
 * Classify a provider failure from HTTP status + (optional) error body. Called
 * only on the failure path. `status === null` means no HTTP response at all
 * (network error / timeout).
 */
export function classifyProviderFailure(
  status: number | null,
  bodyText = "",
): ProviderFailureClass {
  if (status === null) return "unreachable";
  if (status === 401) return "unauthorized";
  if (CAP_SIGNAL.test(bodyText)) return "capped"; // body wins (a 400 cap, a 403 quota, etc.)
  if (status === 402) return "capped";
  if (status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request"; // any other 4xx on the failure path
}

const CLASS_LABEL: Record<ProviderFailureClass, string> = {
  capped: "usage / credit limit reached",
  unauthorized: "authentication failed (bad or missing key)",
  rate_limited: "rate limited (429)",
  server_error: "provider server error (5xx)",
  bad_request: "request rejected (4xx — likely a bad model id or payload)",
  unreachable: "unreachable (network error / timeout)",
};

// One alert per (provider, class, UTC day). Cleared on day rollover so the set
// can't grow without bound.
const alertedToday = new Set<string>();
let alertedDay = "";

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Test seam: reset the daily dedup (used by unit tests). */
export function _resetProviderAlertDedup(): void {
  alertedToday.clear();
  alertedDay = "";
}

export interface ProviderFailure {
  provider: string; // "anthropic" | "openai" | "xai" | "gemini" | "perplexity" | ...
  service: string; // caller id, e.g. "agent-runner" | "seo-engine" | "watchtower:grok"
  status?: number | null; // HTTP status, or null/undefined if no response
  bodyText?: string; // response body (best-effort; may be empty)
  error?: unknown; // the caught error, when there was no HTTP response
  now?: Date; // injectable for tests
}

/**
 * Record a provider call failure: always logs; raises a deduped critical alert
 * (email + alert_events) at most once per provider + class + UTC day. Returns
 * the classified failure class. NEVER throws.
 */
export function noteProviderFailure(f: ProviderFailure): ProviderFailureClass {
  const now = f.now ?? new Date();
  const status = f.status ?? null;
  const detail =
    (f.bodyText && f.bodyText.trim()) ||
    (f.error instanceof Error ? f.error.message : f.error ? String(f.error) : "");
  const cls = classifyProviderFailure(status, `${detail} ${f.bodyText ?? ""}`);

  logger.warn(
    { provider: f.provider, service: f.service, status, cls },
    "AI provider call failed",
  );

  const day = utcDay(now);
  if (day !== alertedDay) {
    alertedToday.clear();
    alertedDay = day;
  }
  const key = `${f.provider}:${cls}:${day}`;
  if (alertedToday.has(key)) return cls;
  alertedToday.add(key);

  const alertType =
    cls === "capped"
      ? "provider_capped"
      : cls === "unauthorized"
        ? "provider_unauthorized"
        : "provider_error";

  const subject = `AI provider ${f.provider}: ${CLASS_LABEL[cls]}`;
  const body =
    `Service "${f.service}" received a ${cls} failure from ${f.provider}` +
    (status != null ? ` (HTTP ${status})` : "") +
    `.\n\nDetail: ${detail.slice(0, 300) || "(none)"}\n\n` +
    `Deduped to one alert per provider/class/day. Affected calls are falling back ` +
    `or failing until this is resolved (e.g. raise the provider's usage limit, ` +
    `rotate the key, or wait out the rate limit).`;

  // Fire-and-forget: alerting must never block or break the caller's fallback.
  void sendAlert(alertType, subject, body).catch((e) =>
    logger.error({ e, provider: f.provider }, "noteProviderFailure: sendAlert failed"),
  );

  return cls;
}
