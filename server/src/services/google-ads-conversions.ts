// ---------------------------------------------------------------------------
// Google Ads offline (click) conversion uploader — minimal fetch-based client,
// no npm dependency (mirrors services/stripe-client.ts).
//
// Purpose: the University purchase happens on Stripe's hosted checkout, so no
// on-page tag can honestly measure it. The storefronts (jointhecoherent.com +
// coherencedaddy.com/university) capture the Google Ads click id
// (gclid / wbraid / gbraid) from the ad's landing URL and forward it in the
// checkout POST body; routes/university-checkout.ts stamps it on the Stripe
// session metadata; and on checkout.session.completed this service uploads a
// ClickConversion to the Google Ads API — the purchase conversion, attributed
// to the exact ad click, with the real amount and the Stripe session id as
// orderId (Google dedupes repeat uploads of the same orderId per action, so a
// Stripe webhook retry can't double-count).
//
// ENV-GATED: until ALL required env vars below are set, uploads are logged
// (level=info, full payload) instead of sent — nothing breaks, and the logged
// payloads + the click ids persisted on Stripe session metadata allow a manual
// backfill within Google's 90-days-after-click upload window. Provisioning
// checklist: docs/deploy/google-ads-conversions.md.
//
//   GOOGLE_ADS_DEVELOPER_TOKEN                 — API Center developer token
//   GOOGLE_ADS_OAUTH_CLIENT_ID                 — OAuth2 web/desktop client id
//   GOOGLE_ADS_OAUTH_CLIENT_SECRET             — OAuth2 client secret
//   GOOGLE_ADS_OAUTH_REFRESH_TOKEN             — refresh token for a user with
//                                                access to the Ads account
//   GOOGLE_ADS_CUSTOMER_ID                     — Ads account id, digits only
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID               — optional MCC id, digits only
//   GOOGLE_ADS_UNIVERSITY_CONVERSION_ACTION_ID — numeric id of the "University
//                                                purchase" conversion action
//   GOOGLE_ADS_API_VERSION                     — optional, default "v21"
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger.js";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API = "https://googleads.googleapis.com";
const DEFAULT_API_VERSION = "v21";

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Ads account the conversion action lives in — digits only, no dashes. */
  customerId: string;
  /** Manager (MCC) account id when access is delegated through one. */
  loginCustomerId?: string;
  /** Numeric id of the conversion action to attribute uploads to. */
  conversionActionId: string;
  apiVersion: string;
}

function envDigits(name: string): string {
  // Customer ids are shown as 123-456-7890 in the Ads UI but the API wants
  // bare digits — strip dashes/spaces so a copy-paste of either form works.
  return (process.env[name] ?? "").replace(/[\s-]/g, "");
}

/** The full uploader config, or null when any required var is missing. */
export function googleAdsConfig(): GoogleAdsConfig | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN?.trim();
  const customerId = envDigits("GOOGLE_ADS_CUSTOMER_ID");
  const conversionActionId =
    process.env.GOOGLE_ADS_UNIVERSITY_CONVERSION_ACTION_ID?.trim();
  if (
    !developerToken
    || !clientId
    || !clientSecret
    || !refreshToken
    || !customerId
    || !conversionActionId
  ) {
    return null;
  }
  const loginCustomerId = envDigits("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    loginCustomerId: loginCustomerId || undefined,
    conversionActionId,
    apiVersion:
      process.env.GOOGLE_ADS_API_VERSION?.trim() || DEFAULT_API_VERSION,
  };
}

export function googleAdsConfigured(): boolean {
  return googleAdsConfig() !== null;
}

// ---------------------------------------------------------------------------
// Conversion payload
// ---------------------------------------------------------------------------

export interface UniversityPurchaseConversion {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  /** Stripe checkout session id — Google's orderId dedupe key. */
  orderId: string;
  /** Real billed amount in cents (metadata.unit_amount_cents); null = unknown. */
  valueCents: number | null;
  /** ISO-4217; defaults to USD. */
  currency?: string;
  /** Conversion moment; defaults to now (webhook time ≈ payment time). */
  occurredAt?: Date;
}

export type UploadResult =
  | { sent: true }
  | {
      sent: false;
      reason: "unconfigured" | "no_click_id" | "api_error";
      detail?: string;
    };

/**
 * Extracts the uploadable conversion from a completed University checkout
 * session (click ids + amount were stamped on metadata by the checkout route).
 * Pure — exported for unit tests.
 */
export function universityConversionFromSession(session: {
  id: string;
  metadata?: Record<string, string> | null;
}): UniversityPurchaseConversion {
  const metadata = session.metadata ?? {};
  const parsedCents = Number.parseInt(metadata.unit_amount_cents ?? "", 10);
  return {
    gclid: metadata.gclid || null,
    wbraid: metadata.wbraid || null,
    gbraid: metadata.gbraid || null,
    orderId: session.id,
    valueCents:
      Number.isFinite(parsedCents) && parsedCents > 0 ? parsedCents : null,
  };
}

/** Google Ads wants "yyyy-MM-dd HH:mm:ss+HH:MM"; we always emit UTC. */
function formatConversionDateTime(d: Date): string {
  const iso = d.toISOString(); // 2026-07-15T21:00:00.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
}

async function fetchAccessToken(cfg: GoogleAdsConfig): Promise<string> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `google-ads oauth token refresh failed (${res.status}): ${
        body.error_description || body.error || "no access_token in response"
      }`,
    );
  }
  return body.access_token;
}

/**
 * Uploads ONE University purchase as a Google Ads click conversion.
 *
 * Never throws on the expected soft paths (unconfigured, organic purchase,
 * API rejection) — it logs and returns a typed result so the webhook stays
 * non-fatal by construction. Network/token errors also resolve to
 * `api_error` (logged) for the same reason.
 */
export async function uploadUniversityPurchaseConversion(
  conv: UniversityPurchaseConversion,
): Promise<UploadResult> {
  // Exactly one click identifier per ClickConversion (Google rejects
  // combinations) — prefer gclid, the strongest match key. Checked BEFORE the
  // config gate so organic/direct purchases (nothing to upload, ever) don't
  // log a misleading "would upload" payload while provisioning is pending.
  const clickId = conv.gclid
    ? { gclid: conv.gclid }
    : conv.wbraid
      ? { wbraid: conv.wbraid }
      : conv.gbraid
        ? { gbraid: conv.gbraid }
        : null;
  if (!clickId) {
    logger.debug(
      { orderId: conv.orderId },
      "google-ads-conversions: purchase carries no click id (organic/direct) — nothing to upload",
    );
    return { sent: false, reason: "no_click_id" };
  }

  const cfg = googleAdsConfig();
  if (!cfg) {
    // Loud, greppable, and complete enough to backfill by hand later —
    // Google accepts click-conversion uploads for 90 days after the click.
    logger.info(
      {
        conversion: {
          gclid: conv.gclid ?? null,
          wbraid: conv.wbraid ?? null,
          gbraid: conv.gbraid ?? null,
          orderId: conv.orderId,
          valueCents: conv.valueCents,
          currency: conv.currency ?? "USD",
          occurredAt: (conv.occurredAt ?? new Date()).toISOString(),
        },
      },
      "google-ads-conversions: NOT CONFIGURED — logging conversion instead of uploading (provisioning: docs/deploy/google-ads-conversions.md; click ids also persist on the Stripe session metadata for backfill)",
    );
    return { sent: false, reason: "unconfigured" };
  }

  try {
    const accessToken = await fetchAccessToken(cfg);

    const conversion: Record<string, unknown> = {
      ...clickId,
      conversionAction: `customers/${cfg.customerId}/conversionActions/${cfg.conversionActionId}`,
      conversionDateTime: formatConversionDateTime(
        conv.occurredAt ?? new Date(),
      ),
      orderId: conv.orderId,
    };
    if (conv.valueCents != null) {
      conversion.conversionValue = conv.valueCents / 100;
      conversion.currencyCode = conv.currency ?? "USD";
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": cfg.developerToken,
      "Content-Type": "application/json",
    };
    if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;

    const res = await fetch(
      `${GOOGLE_ADS_API}/${cfg.apiVersion}/customers/${cfg.customerId}:uploadClickConversions`,
      {
        method: "POST",
        headers,
        // partialFailure is REQUIRED true on this endpoint; per-conversion
        // problems (expired click, duplicate orderId on a webhook retry)
        // come back in partialFailureError instead of failing the request.
        body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      partialFailureError?: { message?: string };
      error?: { message?: string };
    };
    if (!res.ok) {
      const detail = body.error?.message || `HTTP ${res.status}`;
      logger.error(
        { orderId: conv.orderId, status: res.status, detail },
        "google-ads-conversions: upload request failed",
      );
      return { sent: false, reason: "api_error", detail };
    }
    if (body.partialFailureError?.message) {
      // Duplicate orderId (webhook retry) lands here — log at warn, not error.
      logger.warn(
        { orderId: conv.orderId, detail: body.partialFailureError.message },
        "google-ads-conversions: upload partially failed (duplicate retry or expired click are the usual causes)",
      );
      return {
        sent: false,
        reason: "api_error",
        detail: body.partialFailureError.message,
      };
    }
    logger.info(
      { orderId: conv.orderId, valueCents: conv.valueCents },
      "google-ads-conversions: purchase conversion uploaded",
    );
    return { sent: true };
  } catch (err) {
    const detail = (err as Error).message;
    logger.error(
      { err, orderId: conv.orderId },
      "google-ads-conversions: upload errored",
    );
    return { sent: false, reason: "api_error", detail };
  }
}
