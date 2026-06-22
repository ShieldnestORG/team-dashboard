/**
 * Meta Conversions API (CAPI) client — server-side 'Purchase' events.
 *
 * Sends server-side conversion events to the Meta (Facebook) Conversions API
 * graph endpoint (graph.facebook.com/<PIXEL_ID>/events). Used to attribute
 * paid Stripe purchases back to Meta ad campaigns with browser<->server
 * deduplication via a caller-supplied event_id.
 *
 * SAFE NO-OP: reads META_PIXEL_ID + META_CAPI_ACCESS_TOKEN from env. If either
 * is unset the module logs once and no-ops (returns { skipped: true }) — it
 * NEVER throws into the caller. This keeps the Stripe webhook from failing when
 * Meta tokens are absent (e.g. local/dev, or before tokens are provisioned).
 *
 * Privacy: the email is SHA-256 hashed (lowercased + trimmed) before sending,
 * per Meta's Advanced Matching requirements. The fbc/fbp click identifiers are
 * sent RAW (Meta requires them un-hashed).
 */

import { createHash } from "node:crypto";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 8000;

function pixelId(): string {
  return process.env.META_PIXEL_ID?.trim() || "";
}

function accessToken(): string {
  return process.env.META_CAPI_ACCESS_TOKEN?.trim() || "";
}

/**
 * True only when BOTH the pixel id and the CAPI access token are configured.
 * Acts as the feature flag — when false the client no-ops.
 */
export function isEnabled(): boolean {
  return !!pixelId() && !!accessToken();
}

// Log the "disabled" notice at most once per process so an unconfigured Meta
// integration doesn't spam the logs on every purchase.
let loggedDisabled = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PurchaseEventInput {
  /**
   * Caller-supplied event id, shared with the browser-side Pixel event so Meta
   * can de-duplicate the server + browser copies of the same Purchase.
   */
  eventId: string;
  /** Raw (un-hashed) customer email. Hashed with SHA-256 before sending. */
  email: string;
  /** Purchase value (major currency units, e.g. 50 for $50.00). */
  value: number;
  /** ISO-4217 currency code, e.g. "USD". */
  currency: string;
  /** Meta click id cookie (_fbc). Sent RAW — must NOT be hashed. */
  fbc?: string;
  /** Meta browser id cookie (_fbp). Sent RAW — must NOT be hashed. */
  fbp?: string;
  /** Unix epoch seconds for the event. Defaults to now. */
  eventTime?: number;
  /** Source URL of the conversion (event_source_url). Optional. */
  eventSourceUrl?: string;
  /** Override the request timeout (ms). Defaults to 8000. */
  timeoutMs?: number;
}

export type MetaCapiResult =
  | { skipped: true; reason: string }
  | { sent: true; eventId: string; eventsReceived?: number; fbtraceId?: string }
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
 * Send a server-side 'Purchase' event to the Meta Conversions API.
 *
 * Never throws: on missing config returns { skipped: true }; on any HTTP or
 * network failure returns { sent: false, error }. The caller (Stripe webhook)
 * should treat a failure here as non-fatal.
 */
export async function sendPurchaseEvent(
  input: PurchaseEventInput,
): Promise<MetaCapiResult> {
  if (!isEnabled()) {
    if (!loggedDisabled) {
      loggedDisabled = true;
      logger.info(
        "Meta CAPI disabled (META_PIXEL_ID / META_CAPI_ACCESS_TOKEN unset) — skipping Purchase events",
      );
    }
    return { skipped: true, reason: "not_configured" };
  }

  const eventTime = input.eventTime ?? Math.floor(Date.now() / 1000);

  const userData: Record<string, unknown> = {
    em: [sha256Normalized(input.email)],
  };
  // fbc / fbp are sent RAW (Meta requires these un-hashed).
  if (input.fbc) userData.fbc = input.fbc;
  if (input.fbp) userData.fbp = input.fbp;

  const event: Record<string, unknown> = {
    event_name: "Purchase",
    event_time: eventTime,
    event_id: input.eventId,
    action_source: "website",
    user_data: userData,
    custom_data: {
      value: input.value,
      currency: input.currency,
    },
  };
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;

  const url = `${GRAPH_API_BASE}/${GRAPH_API_VERSION}/${pixelId()}/events`;
  const body = JSON.stringify({
    data: [event],
    access_token: accessToken(),
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ error, eventId: input.eventId }, "Meta CAPI Purchase request failed");
    return { sent: false, error };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = `Meta CAPI error (${res.status}): ${text || "no body"}`;
    logger.warn({ status: res.status, eventId: input.eventId }, "Meta CAPI Purchase non-OK response");
    return { sent: false, error };
  }

  const json = (await res.json().catch(() => ({}))) as {
    events_received?: number;
    fbtrace_id?: string;
  };

  return {
    sent: true,
    eventId: input.eventId,
    eventsReceived: json.events_received,
    fbtraceId: json.fbtrace_id,
  };
}
