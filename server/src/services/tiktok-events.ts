/**
 * TikTok Events API (2.0) client — server-side 'CompletePayment' events.
 *
 * Sends server-side conversion events to the TikTok Events API consolidated
 * track endpoint (business-api.tiktok.com/open_api/v1.3/event/track/). Used to
 * attribute paid Stripe purchases back to TikTok ad campaigns with browser<->
 * server deduplication via a caller-supplied event_id.
 *
 * SAFE NO-OP: reads TIKTOK_PIXEL_ID + TIKTOK_EVENTS_TOKEN from env. If either is
 * unset the module logs once and no-ops (returns { skipped: true }) — it NEVER
 * throws into the caller. This keeps the Stripe webhook from failing when TikTok
 * tokens are absent (e.g. local/dev, or before tokens are provisioned).
 *
 * Privacy: the email is SHA-256 hashed (lowercased + trimmed) before sending,
 * per TikTok's Advanced Matching requirements. The ttclid click identifier is
 * sent RAW (TikTok requires it un-hashed).
 *
 * Independent of the unrelated platform-publishers/tiktok.ts video publisher —
 * this module only emits tracking events and shares no code with it.
 */

import { createHash } from "node:crypto";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const EVENTS_API_BASE = "https://business-api.tiktok.com";
const EVENTS_API_VERSION = "v1.3";
const DEFAULT_TIMEOUT_MS = 8000;

function pixelId(): string {
  return process.env.TIKTOK_PIXEL_ID?.trim() || "";
}

function eventsToken(): string {
  return process.env.TIKTOK_EVENTS_TOKEN?.trim() || "";
}

/**
 * True only when BOTH the pixel id and the events token are configured.
 * Acts as the feature flag — when false the client no-ops.
 */
export function isEnabled(): boolean {
  return !!pixelId() && !!eventsToken();
}

// Log the "disabled" notice at most once per process so an unconfigured TikTok
// integration doesn't spam the logs on every purchase.
let loggedDisabled = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletePaymentEventInput {
  /**
   * Caller-supplied event id, shared with the browser-side Pixel event so
   * TikTok can de-duplicate the server + browser copies of the same
   * CompletePayment event.
   */
  eventId: string;
  /** Raw (un-hashed) customer email. Hashed with SHA-256 before sending. */
  email: string;
  /** Purchase value (major currency units, e.g. 50 for $50.00). */
  value: number;
  /** ISO-4217 currency code, e.g. "USD". */
  currency: string;
  /** TikTok click id (ttclid). Sent RAW — must NOT be hashed. */
  ttclid?: string;
  /** content_type for the event properties. Defaults to "product". */
  contentType?: string;
  /** Unix epoch seconds for the event. Defaults to now. */
  eventTime?: number;
  /** Override the request timeout (ms). Defaults to 8000. */
  timeoutMs?: number;
}

export type TikTokEventsResult =
  | { skipped: true; reason: string }
  | { sent: true; eventId: string; code?: number; requestId?: string }
  | { sent: false; error: string };

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 hash of a normalized (trimmed + lowercased) value, hex-encoded. */
function sha256Normalized(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/**
 * Send a server-side 'CompletePayment' event to the TikTok Events API.
 *
 * Never throws: on missing config returns { skipped: true }; on any HTTP or
 * network failure returns { sent: false, error }. The caller (Stripe webhook)
 * should treat a failure here as non-fatal.
 */
export async function sendCompletePaymentEvent(
  input: CompletePaymentEventInput,
): Promise<TikTokEventsResult> {
  if (!isEnabled()) {
    if (!loggedDisabled) {
      loggedDisabled = true;
      logger.info(
        "TikTok Events API disabled (TIKTOK_PIXEL_ID / TIKTOK_EVENTS_TOKEN unset) — skipping CompletePayment events",
      );
    }
    return { skipped: true, reason: "not_configured" };
  }

  const eventTime = input.eventTime ?? Math.floor(Date.now() / 1000);

  const user: Record<string, unknown> = {
    // TikTok expects SHA-256 (hex) of the normalized email.
    email: sha256Normalized(input.email),
  };
  // ttclid is sent RAW (TikTok requires it un-hashed).
  if (input.ttclid) user.ttclid = input.ttclid;

  const eventData: Record<string, unknown> = {
    event: "CompletePayment",
    event_time: eventTime,
    event_id: input.eventId,
    user,
    properties: {
      value: input.value,
      currency: input.currency,
      content_type: input.contentType ?? "product",
    },
  };

  const url = `${EVENTS_API_BASE}/open_api/${EVENTS_API_VERSION}/event/track/`;
  const body = JSON.stringify({
    event_source: "web",
    event_source_id: pixelId(),
    data: [eventData],
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": eventsToken(),
      },
      body,
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error, eventId: input.eventId },
      "TikTok Events CompletePayment request failed",
    );
    return { sent: false, error };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = `TikTok Events API error (${res.status}): ${text || "no body"}`;
    logger.warn(
      { status: res.status, eventId: input.eventId },
      "TikTok Events CompletePayment non-OK response",
    );
    return { sent: false, error };
  }

  // TikTok returns HTTP 200 with a body-level { code, message, request_id }.
  // A non-zero code indicates a logical failure even though the HTTP status
  // was 200.
  const json = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    request_id?: string;
  };

  if (typeof json.code === "number" && json.code !== 0) {
    const error = `TikTok Events API rejected event (code ${json.code}): ${json.message || "no message"}`;
    logger.warn(
      { code: json.code, eventId: input.eventId, requestId: json.request_id },
      "TikTok Events CompletePayment rejected",
    );
    return { sent: false, error };
  }

  return {
    sent: true,
    eventId: input.eventId,
    code: json.code,
    requestId: json.request_id,
  };
}
