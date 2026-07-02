/**
 * Zernio engagement sync tick (hourly cron socials:zernio-sync).
 *
 * Two pulls, both read-only against Zernio:
 *   1) Comment-automation mirror — Zernio stays the source of truth; the local
 *      zernio_comment_automations rows power the cockpit list, and supply the
 *      keyword/clickTag set the webhook lead-capture attributes against.
 *   2) Tagged contacts — the clickTag audience (L3: tag on comment/DM/click,
 *      then sync toward Brevo). Only contacts carrying at least one tag are
 *      captured; untagged inbox contacts never touched a funnel.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  allZernioKeys,
  listZernioCommentAutomations,
  listZernioContactsForKey,
} from "../platform-publishers/zernio.js";
import { logger } from "../../middleware/logger.js";

export interface ZernioSyncResult {
  automationsSeen: number;
  automationsUpserted: number;
  automationsDeactivated: number;
  contactsSeen: number;
  contactLeadsUpserted: number;
  errors: string[];
}

export async function syncZernioAutomationsMirror(
  db: Db,
): Promise<Pick<ZernioSyncResult, "automationsSeen" | "automationsUpserted" | "automationsDeactivated" | "errors">> {
  const { automations, errors } = await listZernioCommentAutomations();
  let upserted = 0;
  for (const a of automations) {
    await db.execute(sql`
      INSERT INTO zernio_comment_automations (
        zernio_automation_id, zernio_account_id, social_account_id, name,
        platform, trigger, keywords, match_mode, dm_message, buttons,
        comment_reply, link_tracking, click_tag, is_active, stats, last_synced_at
      )
      VALUES (
        ${a.id},
        ${a.zernioAccountId},
        (SELECT id FROM social_accounts WHERE zernio_account_id = ${a.zernioAccountId} LIMIT 1),
        ${a.name ?? "(unnamed)"},
        ${a.platform ?? null},
        ${a.trigger ?? "comment"},
        ${JSON.stringify(a.keywords ?? [])}::jsonb,
        ${a.matchMode ?? "contains"},
        ${a.dmMessage ?? ""},
        ${JSON.stringify(a.buttons ?? [])}::jsonb,
        ${a.commentReply ?? null},
        ${a.linkTracking ?? true},
        ${a.clickTag ?? null},
        ${a.isActive ?? true},
        ${JSON.stringify(a.stats ?? {})}::jsonb,
        now()
      )
      ON CONFLICT (zernio_automation_id) DO UPDATE SET
        name = EXCLUDED.name,
        platform = EXCLUDED.platform,
        trigger = EXCLUDED.trigger,
        keywords = EXCLUDED.keywords,
        match_mode = EXCLUDED.match_mode,
        dm_message = EXCLUDED.dm_message,
        buttons = EXCLUDED.buttons,
        comment_reply = EXCLUDED.comment_reply,
        link_tracking = EXCLUDED.link_tracking,
        click_tag = EXCLUDED.click_tag,
        is_active = EXCLUDED.is_active,
        stats = EXCLUDED.stats,
        last_synced_at = now(),
        updated_at = now()
    `);
    upserted += 1;
  }

  // Deactivate mirror rows that vanished from Zernio — but only when every
  // key answered (a partial listing must not mass-deactivate live funnels).
  let deactivated = 0;
  if (errors.length === 0 && automations.length > 0) {
    const liveIds = automations.map((a) => a.id);
    const res = await db.execute(sql`
      UPDATE zernio_comment_automations
         SET is_active = false, updated_at = now()
       WHERE is_active = true
         AND NOT (zernio_automation_id = ANY(${sql.raw(`ARRAY[${liveIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[]`)}))
      RETURNING id
    `);
    deactivated = (res as unknown as unknown[]).length;
  }

  return { automationsSeen: automations.length, automationsUpserted: upserted, automationsDeactivated: deactivated, errors };
}

const CONTACT_PAGE_LIMIT = 200;
const CONTACT_MAX_PAGES = 5;

export async function pollZernioTaggedContacts(
  db: Db,
): Promise<Pick<ZernioSyncResult, "contactsSeen" | "contactLeadsUpserted" | "errors">> {
  let seen = 0;
  let upserted = 0;
  const errors: string[] = [];

  for (const { zernioAccountId, key } of allZernioKeys()) {
    try {
      for (let page = 0; page < CONTACT_MAX_PAGES; page += 1) {
        const { contacts, hasMore } = await listZernioContactsForKey(key, {
          limit: CONTACT_PAGE_LIMIT,
          skip: page * CONTACT_PAGE_LIMIT,
        });
        seen += contacts.length;
        for (const c of contacts) {
          const tags = Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === "string" && t) : [];
          if (!c.id || tags.length === 0) continue; // untagged = never touched a funnel
          await db.execute(sql`
            INSERT INTO social_leads (
              source, capture_kind, platform, zernio_account_id, social_account_id,
              handle, display_name, email, click_tag, zernio_contact_id, tags, payload
            )
            VALUES (
              'zernio',
              'contact_tag',
              ${c.platform ?? null},
              ${zernioAccountId},
              (SELECT id FROM social_accounts WHERE zernio_account_id = ${zernioAccountId} LIMIT 1),
              ${c.displayIdentifier ?? c.platformIdentifier ?? null},
              ${c.name ?? null},
              ${c.email ? String(c.email).toLowerCase() : null},
              ${tags[0]},
              ${c.id},
              ${JSON.stringify(tags)}::jsonb,
              ${JSON.stringify({ platformIdentifier: c.platformIdentifier ?? null })}::jsonb
            )
            ON CONFLICT (zernio_contact_id) WHERE zernio_contact_id IS NOT NULL
            DO UPDATE SET
              email = COALESCE(social_leads.email, EXCLUDED.email),
              click_tag = COALESCE(social_leads.click_tag, EXCLUDED.click_tag),
              tags = EXCLUDED.tags,
              display_name = COALESCE(EXCLUDED.display_name, social_leads.display_name),
              handle = COALESCE(EXCLUDED.handle, social_leads.handle),
              last_event_at = now(),
              updated_at = now()
          `);
          upserted += 1;
        }
        if (!hasMore) break;
      }
    } catch (err) {
      errors.push(`${zernioAccountId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { contactsSeen: seen, contactLeadsUpserted: upserted, errors };
}

export async function runZernioEngagementSyncTick(db: Db): Promise<ZernioSyncResult> {
  if (allZernioKeys().length === 0) {
    // No keys configured (local/dev) — quiet no-op, not a cron error.
    return {
      automationsSeen: 0,
      automationsUpserted: 0,
      automationsDeactivated: 0,
      contactsSeen: 0,
      contactLeadsUpserted: 0,
      errors: [],
    };
  }
  const mirror = await syncZernioAutomationsMirror(db);
  const contacts = await pollZernioTaggedContacts(db);
  const result: ZernioSyncResult = { ...mirror, ...contacts, errors: [...mirror.errors, ...contacts.errors] };
  logger.info(
    {
      automations: result.automationsUpserted,
      deactivated: result.automationsDeactivated,
      contacts: result.contactLeadsUpserted,
      errors: result.errors.length,
    },
    "zernio-sync tick",
  );
  return result;
}
