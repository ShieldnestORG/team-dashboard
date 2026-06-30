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
  | "portal_magic_link"
  | "welcome_starter"
  | "welcome_growth"
  | "welcome_pro"
  | "one_time_report"
  | "monthly_report"
  | "weekly_report"
  | "fix_priority_monthly"
  | "score_drop_alert"
  | "sage_weekly_digest"
  // Coherent Ones University ($50/mo membership). Templates live storefront-side
  // (docs/OWNERSHIP.md); this contract is the team-dashboard → storefront kind list.
  | "university_welcome"
  | "university_receipt"
  | "university_past_due"
  | "university_canceled"
  | "university_onboarding_d1"
  | "university_onboarding_d3"
  | "university_winback"
  // Streak nudge ("you're about to break your streak"). Fired by the
  // university:streak-nudge cron to active members who repped yesterday but not
  // yet today. Commercial-classed storefront-side (suppression + unsubscribe).
  | "university_streak_nudge"
  // Community reply notification ("someone replied to your post"). The storefront
  // Resend template is owner-gated (must ship CAN-SPAM compliant); until it
  // exists this kind no-ops via the warn-and-continue callback, so the in-app
  // unread badge works without it.
  | "university_community_reply"
  // Live-session lifecycle. Windowed reminder crons fan these out to RSVP'd
  // members (T-24h / T-1h); the canceled notice is event-driven from the admin
  // cancel route. Templates live storefront-side (owner-gated).
  | "university_session_reminder_24h"
  | "university_session_reminder_1h"
  | "university_session_canceled"
  // RSVP confirmation — sent the moment a member RSVPs `going` (new OR
  // re-activated from a prior canceled; NOT on a no-op repeat going). Carries
  // the .ics calendarUrl so the member can add the sit to their calendar.
  // Transactional storefront-side.
  | "university_session_rsvp_confirm"
  // "We are live now" — sent at start time to going RSVPs with the real
  // join_url (the room is live once the join window opens). Fired by the
  // per-minute windowed cron `university:session-starting-now`. Transactional.
  | "university_session_starting_now"
  // New-session announcement — broadcast to ALL active members when an admin
  // creates a session (event-driven from createSession). COMMERCIAL storefront-
  // side: the storefront adds postal address + working unsubscribe + suppression
  // gate. messageId = announce:<sessionId>:<emailLower> for retry idempotency.
  | "university_session_announce"
  // Post-session recap — sent shortly after a session ends to going RSVPs.
  // recordingUrl is null until a later wave adds the column; the storefront
  // template handles the null gracefully. Fired by the per-minute windowed cron
  // `university:session-recap`. Transactional.
  | "university_session_recap";

export interface SendArgs {
  kind: CreditscoreEmailKind;
  to: string;
  data: Record<string, unknown>;
  // Optional idempotency key so the storefront can drop duplicates.
  messageId?: string;
}

// Exported for unit testing.
export function signBody(body: string, secret: string): string {
  return `v1=${createHmac("sha256", secret).update(body).digest("hex")}`;
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
