/**
 * Zernio webhook event → captured lead (plan-zernio-leverage §2 step 8).
 *
 * Deterministic extraction only — no model in the loop. A lead row is the
 * social-capture layer; Brevo remains the nurture CRM and only rows that
 * carry an email are synced there (social-relayer lead tick).
 */

import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { zernioCommentAutomations } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export interface CapturedLead {
  captureKind: "comment" | "dm" | "lead_form";
  platform: string | null;
  zernioAccountId: string | null;
  platformUserId: string | null;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  keyword: string | null;
  clickTag: string | null;
  payload: Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function extractEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = EMAIL_RE.exec(text);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Pure event→lead extraction (exported for tests). Returns null for event
 * types that don't capture a person (post.*, account.*, webhook.test, ...).
 */
export function extractLeadFromZernioEvent(
  eventType: string,
  payload: Record<string, unknown>,
): CapturedLead | null {
  const account = rec(payload.account);
  const zernioAccountId = str(account.id);

  if (eventType === "comment.received") {
    const comment = rec(payload.comment);
    const author = rec(comment.author);
    return {
      captureKind: "comment",
      platform: str(comment.platform) ?? str(account.platform),
      zernioAccountId,
      platformUserId: str(author.id),
      handle: str(author.username),
      displayName: str(author.name),
      email: extractEmail(str(comment.text)),
      keyword: null, // resolved against the automation mirror by the caller
      clickTag: null,
      payload: { text: str(comment.text), commentId: str(comment.id), postId: str(comment.platformPostId) },
    };
  }

  if (eventType === "message.received") {
    const message = rec(payload.message);
    // Only inbound DMs capture a lead; our own outbound sends do not.
    if (str(message.direction) === "outgoing") return null;
    const sender = rec(message.sender);
    return {
      captureKind: "dm",
      platform: str(message.platform) ?? str(account.platform),
      zernioAccountId,
      platformUserId: str(sender.id),
      handle: str(sender.username),
      displayName: str(sender.name),
      // In-window replies are where emails actually get typed (quiz/capture
      // funnels) — a deterministic regex pull, never a model.
      email: extractEmail(str(message.text)),
      keyword: null,
      clickTag: null,
      payload: {
        text: str(message.text),
        conversationId: str(message.conversationId),
        zernioContactId: str(sender.contactId),
      },
    };
  }

  if (eventType === "lead.received") {
    const lead = rec(payload.lead);
    const fields = rec(lead.fields);
    let email: string | null = null;
    let name: string | null = null;
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v !== "string") continue;
      if (!email && (/email/i.test(k) || EMAIL_RE.test(v))) email = extractEmail(v) ?? email;
      if (!name && /name/i.test(k)) name = v;
    }
    return {
      captureKind: "lead_form",
      platform: str(account.platform) ?? "facebook",
      zernioAccountId,
      // leadgenId keys dedup per submission (a form submit IS one lead).
      platformUserId: str(lead.leadgenId) ? `leadgen:${str(lead.leadgenId)}` : null,
      handle: null,
      displayName: name,
      email,
      keyword: null,
      clickTag: null,
      payload: { fields, formId: str(lead.formId), adId: str(lead.adId), isOrganic: lead.isOrganic === true },
    };
  }

  return null;
}

/**
 * Deterministic keyword attribution: match the text against the account's
 * active automation mirror (ROOM/COHERENT/...), honoring each automation's
 * matchMode. First hit wins; returns its keyword + clickTag.
 */
export async function resolveKeywordAttribution(
  db: Db,
  zernioAccountId: string | null,
  text: string | null,
): Promise<{ keyword: string | null; clickTag: string | null }> {
  if (!zernioAccountId || !text) return { keyword: null, clickTag: null };
  const rows = await db
    .select({
      keywords: zernioCommentAutomations.keywords,
      matchMode: zernioCommentAutomations.matchMode,
      clickTag: zernioCommentAutomations.clickTag,
    })
    .from(zernioCommentAutomations)
    .where(
      and(
        eq(zernioCommentAutomations.zernioAccountId, zernioAccountId),
        eq(zernioCommentAutomations.isActive, true),
      ),
    );
  const haystack = text.trim().toLowerCase();
  for (const row of rows) {
    for (const kw of row.keywords ?? []) {
      const needle = kw.trim().toLowerCase();
      if (!needle) continue;
      const hit = row.matchMode === "exact" ? haystack === needle : haystack.includes(needle);
      if (hit) return { keyword: kw, clickTag: row.clickTag ?? null };
    }
  }
  return { keyword: null, clickTag: null };
}

/**
 * Upsert a webhook-derived lead. Keyed on (source, platform, platform_user_id)
 * — the partial unique index from migration 0122_zernio_engagement — so a
 * repeat commenter/replier stays one row with a bumped event_count. Existing
 * email/keyword/click_tag are never blanked by a later capture that lacks them.
 */
export async function upsertSocialLead(db: Db, lead: CapturedLead): Promise<void> {
  await db.execute(sql`
    INSERT INTO social_leads (
      source, capture_kind, platform, zernio_account_id, social_account_id,
      platform_user_id, handle, display_name, email, keyword, click_tag, payload
    )
    VALUES (
      'zernio',
      ${lead.captureKind},
      ${lead.platform},
      ${lead.zernioAccountId},
      (SELECT id FROM social_accounts WHERE zernio_account_id = ${lead.zernioAccountId} LIMIT 1),
      ${lead.platformUserId},
      ${lead.handle},
      ${lead.displayName},
      ${lead.email},
      ${lead.keyword},
      ${lead.clickTag},
      ${JSON.stringify(lead.payload)}::jsonb
    )
    ON CONFLICT (source, platform, platform_user_id) WHERE platform_user_id IS NOT NULL
    DO UPDATE SET
      event_count = social_leads.event_count + 1,
      last_event_at = now(),
      email = COALESCE(social_leads.email, EXCLUDED.email),
      keyword = COALESCE(EXCLUDED.keyword, social_leads.keyword),
      click_tag = COALESCE(EXCLUDED.click_tag, social_leads.click_tag),
      handle = COALESCE(EXCLUDED.handle, social_leads.handle),
      display_name = COALESCE(EXCLUDED.display_name, social_leads.display_name),
      payload = EXCLUDED.payload,
      updated_at = now()
  `);
}

/**
 * Process one verified, deduped webhook event. Returns a short outcome label
 * stored on the event row. Never throws for unknown event types — at-least-once
 * delivery means unknown/future events are stored and acknowledged.
 */
export async function processZernioWebhookEvent(
  db: Db,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const lead = extractLeadFromZernioEvent(eventType, payload);
  if (lead) {
    if (lead.captureKind === "comment" || lead.captureKind === "dm") {
      const text = str(rec(payload.comment).text) ?? str(rec(payload.message).text);
      const attribution = await resolveKeywordAttribution(db, lead.zernioAccountId, text);
      lead.keyword = attribution.keyword;
      lead.clickTag = attribution.clickTag;
    }
    if (!lead.platformUserId) return "skipped: no platform user id";
    await upsertSocialLead(db, lead);
    return `lead:${lead.captureKind}`;
  }

  if (eventType === "account.disconnected") {
    const account = rec(payload.account);
    const zid = str(account.id);
    if (!zid) return "skipped: no account id";
    // Pause the matching account so the relayer stops dispatching doomed
    // publishes; visible + reversible in the Socials Hub accounts view.
    await db.execute(sql`
      UPDATE social_accounts
         SET status = 'paused',
             automation_notes = concat(
               coalesce(automation_notes, ''),
               ' [zernio: disconnected, auto-paused ', to_char(now(), 'YYYY-MM-DD'), ']'
             ),
             updated_at = now()
       WHERE zernio_account_id = ${zid}
         AND status = 'active'
    `);
    logger.warn({ zid }, "zernio account.disconnected — matching social_accounts paused");
    return "account paused";
  }

  // post.published / post.failed / webhook.test / anything future: the stored
  // event row IS the deliverable (cockpit stream); no state mutation.
  return "stored";
}
