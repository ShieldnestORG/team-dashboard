// ---------------------------------------------------------------------------
// Watchtower email callback — outbound signed HTTP to the storefront.
//
// Mirrors creditscore-email-callback.ts. Per docs/OWNERSHIP.md, Resend
// templates live in coherencedaddy-landing; team-dashboard posts a
// {kind, to, data} envelope with HMAC-SHA256 signature, the storefront
// resolves the template and calls Resend.
//
// This file is deliberately decoupled from the watchtower service so that
// shipping the storefront-side template later doesn't require a backend
// redeploy — the callback fails-soft when env vars are missing.
//
// Secrets:
//   WATCHTOWER_CALLBACK_KEY        — shared HMAC secret with storefront.
//   WATCHTOWER_EMAIL_CALLBACK_URL  — storefront receiver, optional.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import { logger } from "../middleware/logger.js";

export type WatchtowerEmailKind =
  | "watchtower_weekly_digest"
  | "answer_check_report";

export interface WatchtowerWeeklyDigestData {
  brand: string;
  weekStartISO: string;
  totalMentions: number;
  totalPrompts: number;
  totalEngines: number;
  topExcerpts: Array<{
    engine: string;
    prompt: string;
    sentiment: string;
    excerpt: string;
  }>;
  reportUrl: string;
  /**
   * UTM-tagged portal deep-link to this run's dashboard view. Rendered as
   * the primary footer CTA. See `buildDashboardRunUrl`.
   */
  dashboardUrl: string;
  /**
   * UTM-tagged portal billing page link. Rendered as a small footer link
   * ("Manage subscription") to reduce churn-via-buried-cancel.
   */
  manageSubscriptionUrl: string;
  /**
   * Google-rank entries (migration 0119). Optional and backwards-compatible:
   * present only for trackRank subscriptions. The storefront digest template
   * renders a "Google rank" section when this is a non-empty array.
   */
  rank?: Array<{
    query: string;
    position: number | null;
    matchedUrl: string | null;
    topUrl: string | null;
  }>;
  // TODO(stream-f): when Agent E ships the `watchtower_prompt_versions`
  // table (PR pending), add an optional `promptVersionChange` field here
  // and inline a "prompt set changed since last run" notice in the
  // template. Skipped now to avoid blocking on that schema.
}

// ---------------------------------------------------------------------------
// Portal URL helpers (UTM-tagged)
//
// Convention: read `PORTAL_BASE_URL`, fall back to `https://app.coherencedaddy.com`.
// Mirrors `server/src/services/customer-portal.ts:portalBaseUrl()` so the
// digest, the Stripe-portal redirect, and the upsell endpoint all agree on
// what "the portal" is.
// ---------------------------------------------------------------------------

function portalBaseUrl(): string {
  return (
    process.env.PORTAL_BASE_URL?.trim() || "https://app.coherencedaddy.com"
  ).replace(/\/$/, "");
}

export function buildDashboardRunUrl(runId: string): string {
  const base = portalBaseUrl();
  const qs = new URLSearchParams({
    run: runId,
    utm_source: "watchtower-digest",
    utm_medium: "email",
    utm_campaign: "weekly-digest",
  });
  return `${base}/watchtower?${qs.toString()}`;
}

export function buildManageSubscriptionUrl(): string {
  const base = portalBaseUrl();
  const qs = new URLSearchParams({
    utm_source: "watchtower-digest",
    utm_medium: "email",
    utm_campaign: "manage-subscription",
  });
  return `${base}/billing?${qs.toString()}`;
}

export interface AnswerCheckReportData {
  brand: string;
  domain: string | null;
  prompt: string;
  mentionCount: number;
  enginesUsed: string[];
  perEngine: Array<{
    engine: string;
    ok: boolean;
    mentioned: boolean;
    sentiment: string;
    excerpt: string | null;
  }>;
  upgradeUrl: string;
}

export interface SendArgs<TData> {
  kind: WatchtowerEmailKind;
  to: string;
  data: TData;
  messageId?: string;
}

export function signBody(body: string, secret: string): string {
  return `v1=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function callbackEndpoint(): string | null {
  const url = process.env.WATCHTOWER_EMAIL_CALLBACK_URL?.trim();
  if (url) return url;
  // Fallback to the storefront prod path (consistent with creditscore).
  // Disable the fallback by setting WATCHTOWER_EMAIL_CALLBACK_URL_FALLBACK_ENABLED=false.
  if (process.env.WATCHTOWER_EMAIL_CALLBACK_URL_FALLBACK_ENABLED === "false") {
    return null;
  }
  return "https://freetools.coherencedaddy.com/api/email/watchtower";
}

export async function sendAnswerCheckReport(
  args: SendArgs<AnswerCheckReportData>,
): Promise<void> {
  return postEnvelope(args);
}

export async function sendWatchtowerDigest(
  args: SendArgs<WatchtowerWeeklyDigestData>,
): Promise<void> {
  return postEnvelope(args);
}

async function postEnvelope<T>(args: SendArgs<T>): Promise<void> {
  const secret = process.env.WATCHTOWER_CALLBACK_KEY?.trim();
  const endpoint = callbackEndpoint();

  if (!secret || !endpoint) {
    logger.warn(
      { kind: args.kind, hasSecret: !!secret, hasEndpoint: !!endpoint },
      "watchtower-email: callback not configured, skipping send",
    );
    return;
  }

  const body = JSON.stringify({
    kind: args.kind,
    to: args.to,
    data: args.data,
    messageId: args.messageId,
    sentAt: new Date().toISOString(),
  });

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Watchtower-Signature": signBody(body, secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error(
        {
          kind: args.kind,
          to: args.to,
          status: res.status,
          text: text.slice(0, 200),
        },
        "watchtower-email: callback returned non-2xx",
      );
      return;
    }
    logger.info({ kind: args.kind, to: args.to }, "watchtower-email: delivered");
  } catch (err) {
    logger.error(
      { err, kind: args.kind, to: args.to },
      "watchtower-email: callback failed",
    );
  }
}
