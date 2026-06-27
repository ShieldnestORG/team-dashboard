/**
 * Watchtower — GA4 traffic fetcher
 *
 * Opt-in (migration 0139). For subscriptions with `track_ga4` enabled and a
 * `ga4_property_id` set, the weekly run pulls last-7-days traffic from the GA4
 * Data API to feed the digest's "Performance" section.
 *
 * Mirrors the OAuth-refresh + fail-soft pattern of services/youtube/
 * analytics.ts: a shared Google OAuth refresh token mints a short-lived
 * access token. On any error or missing creds we log and return null — this
 * NEVER throws, so a misconfigured property can't break the weekly run.
 *
 * No new npm deps: raw `fetch` against the GA4 Data API v1beta runReport.
 */

import { logger } from "../middleware/logger.js";

const GA4_CLIENT_ID = process.env.WATCHTOWER_GA4_CLIENT_ID || "";
const GA4_CLIENT_SECRET = process.env.WATCHTOWER_GA4_CLIENT_SECRET || "";
const GA4_REFRESH_TOKEN = process.env.WATCHTOWER_GA4_REFRESH_TOKEN || "";

export interface Ga4Traffic {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  conversions: number;
}

async function getAccessToken(): Promise<string | null> {
  if (!GA4_CLIENT_ID || !GA4_CLIENT_SECRET || !GA4_REFRESH_TOKEN) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GA4_CLIENT_ID,
        client_secret: GA4_CLIENT_SECRET,
        refresh_token: GA4_REFRESH_TOKEN,
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

function metricValue(
  rows: Array<{ metricValues?: Array<{ value?: string }> }> | undefined,
  index: number,
): number {
  const raw = rows?.[0]?.metricValues?.[index]?.value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pull last-7-days (by default) traffic for one GA4 property. Returns null on
 * missing creds or any error — never throws.
 */
export async function fetchGa4Traffic(
  propertyId: string,
  opts?: { startDate?: string; endDate?: string },
): Promise<Ga4Traffic | null> {
  if (!propertyId) return null;

  const token = await getAccessToken();
  if (!token) {
    logger.warn("watchtower/ga4: not configured — skipping GA4 traffic fetch");
    return null;
  }

  const startDate = opts?.startDate ?? "7daysAgo";
  const endDate = opts?.endDate ?? "yesterday";

  try {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "newUsers" },
            { name: "conversions" },
          ],
        }),
      },
    );

    if (!res.ok) {
      logger.error(
        { status: res.status, propertyId },
        "watchtower/ga4: runReport failed",
      );
      return null;
    }

    const data = (await res.json()) as {
      rows?: Array<{ metricValues?: Array<{ value?: string }> }>;
    };

    return {
      sessions: metricValue(data.rows, 0),
      totalUsers: metricValue(data.rows, 1),
      newUsers: metricValue(data.rows, 2),
      conversions: metricValue(data.rows, 3),
    };
  } catch (err) {
    logger.error({ err, propertyId }, "watchtower/ga4: traffic fetch failed");
    return null;
  }
}
