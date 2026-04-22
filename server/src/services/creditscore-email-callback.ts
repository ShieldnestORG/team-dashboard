import { createHmac } from "node:crypto";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Outbound signed HTTP callback to coherencedaddy-landing for Resend email
// delivery. Per docs/OWNERSHIP.md, email templates live in the storefront
// (`lib/creditscore-email.ts`). team-dashboard posts { kind, to, data } with
// an HMAC-SHA256 signature; storefront verifies with the same shared secret
// and invokes the appropriate template.
//
// Shared secret: CREDITSCORE_CALLBACK_KEY (symmetric).
// Endpoint:      CREDITSCORE_EMAIL_CALLBACK_URL (default: storefront prod).
// Header:        X-Creditscore-Signature: v1=<hex hmac of body>
//
// If either env var is unset, the callback is skipped (warn-and-continue).
// This lets the team-dashboard backend run in prod even before the storefront
// side ships its receiving route.
// ---------------------------------------------------------------------------

export type CreditscoreEmailKind =
  | "welcome_starter"
  | "welcome_growth"
  | "welcome_pro"
  | "one_time_report"
  | "monthly_report"
  | "weekly_report"
  | "fix_priority_monthly"
  | "score_drop_alert"
  | "sage_weekly_digest";

export interface SendArgs {
  kind: CreditscoreEmailKind;
  to: string;
  data: Record<string, unknown>;
  // Optional idempotency key so the storefront can drop duplicates.
  messageId?: string;
}

function callbackEndpoint(): string | null {
  const url = process.env.CREDITSCORE_EMAIL_CALLBACK_URL?.trim();
  if (url) return url;
  // Best-practice default: storefront production domain.
  const fallback = "https://freetools.coherencedaddy.com/api/email/creditscore";
  return process.env.CREDITSCORE_EMAIL_CALLBACK_URL_FALLBACK_ENABLED === "false"
    ? null
    : fallback;
}

function signBody(body: string, secret: string): string {
  return `v1=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function sendCreditscoreEmail(args: SendArgs): Promise<void> {
  const secret = process.env.CREDITSCORE_CALLBACK_KEY?.trim();
  const endpoint = callbackEndpoint();

  if (!secret || !endpoint) {
    logger.warn(
      { kind: args.kind, hasSecret: !!secret, hasEndpoint: !!endpoint },
      "creditscore-email: callback not configured, skipping send",
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
        "X-Creditscore-Signature": signBody(body, secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error(
        { kind: args.kind, to: args.to, status: res.status, text: text.slice(0, 200) },
        "creditscore-email: callback returned non-2xx",
      );
      return;
    }
    logger.info({ kind: args.kind, to: args.to }, "creditscore-email: delivered");
  } catch (err) {
    logger.error(
      { err, kind: args.kind, to: args.to },
      "creditscore-email: callback failed",
    );
  }
}
