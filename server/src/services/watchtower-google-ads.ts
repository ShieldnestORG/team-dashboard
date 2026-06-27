/**
 * Watchtower — Google Ads spend fetcher
 *
 * Opt-in (migration 0139). For subscriptions with `track_ads` enabled and a
 * `google_ads_customer_id` set, the weekly run pulls last-7-days spend/clicks/
 * conversions from the Google Ads API to feed the digest's "Performance"
 * section.
 *
 * Mirrors the OAuth-refresh + fail-soft pattern of services/youtube/
 * analytics.ts: a shared Google OAuth refresh token mints a short-lived
 * access token. On any error or missing creds we log and return null — this
 * NEVER throws, so a misconfigured customer can't break the weekly run.
 *
 * No new npm deps: raw `fetch` against the Google Ads API search endpoint.
 */

import { logger } from "../middleware/logger.js";

const ADS_CLIENT_ID = process.env.WATCHTOWER_ADS_CLIENT_ID || "";
const ADS_CLIENT_SECRET = process.env.WATCHTOWER_ADS_CLIENT_SECRET || "";
const ADS_REFRESH_TOKEN = process.env.WATCHTOWER_ADS_REFRESH_TOKEN || "";
const ADS_DEVELOPER_TOKEN = process.env.WATCHTOWER_ADS_DEVELOPER_TOKEN || "";
const ADS_LOGIN_CUSTOMER_ID = process.env.WATCHTOWER_ADS_LOGIN_CUSTOMER_ID || "";

export interface AdsPerformance {
  costMicros: number;
  costCents: number;
  clicks: number;
  conversions: number;
  costPerLeadCents: number | null;
}

async function getAccessToken(): Promise<string | null> {
  if (!ADS_CLIENT_ID || !ADS_CLIENT_SECRET || !ADS_REFRESH_TOKEN) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: ADS_CLIENT_ID,
        client_secret: ADS_CLIENT_SECRET,
        refresh_token: ADS_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  } catch {
    return null;
  }
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pull last-7-days spend/clicks/conversions for one Ads customer. Returns null
 * on missing creds or any error — never throws.
 */
export async function fetchAdsPerformance(
  customerId: string,
  _opts?: { since?: string; until?: string },
): Promise<AdsPerformance | null> {
  if (!customerId) return null;
  if (!ADS_DEVELOPER_TOKEN) {
    logger.warn("watchtower/ads: not configured — skipping Ads spend fetch");
    return null;
  }

  const token = await getAccessToken();
  if (!token) {
    logger.warn("watchtower/ads: not configured — skipping Ads spend fetch");
    return null;
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    };
    if (ADS_LOGIN_CUSTOMER_ID) {
      headers["login-customer-id"] = ADS_LOGIN_CUSTOMER_ID;
    }

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query:
            "SELECT metrics.cost_micros, metrics.clicks, metrics.conversions FROM customer WHERE segments.date DURING LAST_7_DAYS",
        }),
      },
    );

    if (!res.ok) {
      logger.error(
        { status: res.status, customerId },
        "watchtower/ads: search failed",
      );
      return null;
    }

    const data = (await res.json()) as {
      results?: Array<{
        metrics?: {
          costMicros?: string | number;
          clicks?: string | number;
          conversions?: string | number;
        };
      }>;
    };

    let costMicros = 0;
    let clicks = 0;
    let conversions = 0;
    for (const row of data.results ?? []) {
      costMicros += num(row.metrics?.costMicros);
      clicks += num(row.metrics?.clicks);
      conversions += num(row.metrics?.conversions);
    }

    const costCents = Math.round(costMicros / 10000);
    const costPerLeadCents =
      conversions > 0 ? Math.round(costCents / conversions) : null;

    return { costMicros, costCents, clicks, conversions, costPerLeadCents };
  } catch (err) {
    logger.error({ err, customerId }, "watchtower/ads: spend fetch failed");
    return null;
  }
}
