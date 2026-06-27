// ---------------------------------------------------------------------------
// "What's Hot" digest email — outbound signed HTTP to the storefront, mirroring
// watchtower-email-callback.ts. Per docs/OWNERSHIP.md the Resend template lives
// in coherencedaddy-landing; team-dashboard posts a {kind, to, data} envelope
// with an HMAC-SHA256 signature and the storefront renders + sends.
//
// Rule 5 rides along to the renderer: every item carries its provenance badge
// (✅ / 🟡 / ⚠), and `adFriendlyItemIds` marks the ✅-only subset the storefront
// must use for any paid-ad copy.
//
// Secrets (reuses the Watchtower callback key to avoid a new shared secret):
//   WATCHTOWER_CALLBACK_KEY       — shared HMAC secret with storefront.
//   WHATS_HOT_EMAIL_CALLBACK_URL  — storefront receiver, optional (falls back
//                                   to the apex /api/email/whats-hot).
// Fail-soft: a missing key/endpoint logs and skips — never throws.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { PROVENANCE_BADGE, type TrendDigest } from "./types.js";

export interface WhatsHotEmailItem {
  title: string;
  category: string;
  whatsHot: string;
  whyItsHot: string;
  stats: Array<{ label: string; display: string }>;
  verdict: string;
  saturationEvidence: string;
  provenanceBadge: string; // ✅ / 🟡 / ⚠
  reuseAngle?: string;
}

export interface WhatsHotDigestData {
  digestDate: string;
  itemCount: number;
  items: WhatsHotEmailItem[];
  /** Item ids cleared for paid-ad copy — ✅ only (Rule 5). */
  adFriendlyItemIds: string[];
  feedUrl: string;
  manageUrl: string;
}

export interface SendArgs {
  kind: "whats_hot_digest";
  to: string;
  data: WhatsHotDigestData;
  messageId?: string;
}

function feedUrl(): string {
  return (
    process.env.WHATS_HOT_FEED_URL?.trim() ||
    "https://coherencedaddy.com/university"
  ).replace(/\/$/, "");
}

/** Map a published TrendDigest to the trimmed email payload. */
export function toEmailData(digest: TrendDigest): WhatsHotDigestData {
  return {
    digestDate: digest.digestDate,
    itemCount: digest.items.length,
    items: digest.items.map((i) => ({
      title: i.title,
      category: i.category,
      whatsHot: i.whatsHot.text,
      whyItsHot: i.whyItsHot.text,
      stats: i.stats.map((s) => ({ label: s.label, display: s.display })),
      verdict: i.saturation.verdict,
      saturationEvidence: i.saturation.evidence,
      provenanceBadge: PROVENANCE_BADGE[i.provenance],
      reuseAngle: i.reuseAngle,
    })),
    adFriendlyItemIds: digest.adFriendlyItemIds,
    feedUrl: feedUrl(),
    manageUrl: `${feedUrl()}/account`,
  };
}

export function signBody(body: string, secret: string): string {
  return `v1=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function callbackEndpoint(): string | null {
  const url = process.env.WHATS_HOT_EMAIL_CALLBACK_URL?.trim();
  if (url) return url;
  if (process.env.WHATS_HOT_EMAIL_CALLBACK_URL_FALLBACK_ENABLED === "false") {
    return null;
  }
  return "https://coherencedaddy.com/api/email/whats-hot";
}

/** Send one member their digest email (fail-soft). */
export async function sendWhatsHotDigest(args: SendArgs): Promise<boolean> {
  const secret = process.env.WATCHTOWER_CALLBACK_KEY?.trim();
  const endpoint = callbackEndpoint();
  if (!secret || !endpoint) {
    logger.warn(
      { hasSecret: !!secret, hasEndpoint: !!endpoint },
      "whats-hot-email: callback not configured, skipping send",
    );
    return false;
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
        { to: args.to, status: res.status, text: text.slice(0, 200) },
        "whats-hot-email: callback returned non-2xx",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, to: args.to }, "whats-hot-email: callback failed");
    return false;
  }
}

/**
 * Blast an APPROVED digest to the active University founding list. Caller is
 * responsible for only invoking this on an approved digest (Rule 7). Returns
 * the number of members the envelope was accepted for. Fail-soft per member.
 */
export async function sendWhatsHotDigestToFoundingList(
  db: Db,
  digest: TrendDigest,
): Promise<{ sent: number; total: number }> {
  const data = toEmailData(digest);
  const result = await db.execute(sql`
    SELECT email FROM university_members
    WHERE status = 'active' AND email IS NOT NULL
  `);
  const raw = result as unknown;
  const recipients = (
    Array.isArray(raw)
      ? (raw as Array<{ email: string }>)
      : ((raw as { rows?: Array<{ email: string }> }).rows ?? [])
  ).filter((r) => r.email);

  let sent = 0;
  for (const r of recipients) {
    const ok = await sendWhatsHotDigest({
      kind: "whats_hot_digest",
      to: r.email,
      data,
      messageId: `whats-hot-${digest.digestDate}-${r.email}`,
    });
    if (ok) sent++;
  }
  logger.info(
    { date: digest.digestDate, sent, total: recipients.length },
    "whats-hot-email: founding-list blast complete",
  );
  return { sent, total: recipients.length };
}
