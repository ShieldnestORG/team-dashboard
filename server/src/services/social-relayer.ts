/**
 * Social posts relayer — drains the social_posts queue.
 *
 * Picks rows where status='scheduled' AND scheduled_at <= now(),
 * acquires a row lock with FOR UPDATE SKIP LOCKED so multiple ticks /
 * processes can't double-publish, dispatches to the platform publisher
 * resolved from the row's social_account, and writes back the result.
 *
 * On failure: bumps `attempts`. Below max_attempts → status stays
 * 'scheduled' so the next tick retries. At/over max_attempts → 'failed'.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { resolvePublisher } from "./platform-publishers/index.js";
import type { PublishResult } from "./platform-publishers/index.js";
import { canPublish } from "./socials/platform-caps.js";
import type { StorageService } from "../storage/types.js";
import {
  isAlreadyPublicUrl,
  isR2StagingConfigured,
  stageBufferToR2,
} from "../storage/r2-staging.js";

const BATCH_SIZE = 5;

// Company prefix StorageService.getObject() requires the media objectKey to
// begin with. team-dashboard is single-company; the relayer has no per-row
// companyId column, so we use the configured company id to satisfy the
// ownership check when resolving an internal objectKey to bytes.
// Read at CALL TIME (not cached at import) so a late-set env var is honored.
function companyId(): string {
  return process.env.TEAM_DASHBOARD_COMPANY_ID ?? "";
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Resolve a post's media entries to PUBLIC absolute URLs Zernio can fetch.
 *
 * - Entries that are ALREADY a public http(s) URL pass through unchanged
 *   (never re-staged — idempotent, and avoids touching URLs from prior runs).
 * - Any other entry is treated as an INTERNAL storage objectKey: its bytes are
 *   fetched via storageService and staged to the public R2 bucket; the entry is
 *   replaced with the resulting `*.r2.dev` URL.
 *
 * FAIL LOUD: if R2 is needed but unconfigured, or any fetch/stage fails, this
 * throws. The caller marks the post failed and NEVER dispatches a non-public
 * URL. The publisher's own non-public-URL guard remains the backstop.
 *
 * Returns null when no entry needed staging (caller can skip the row update),
 * else the fully-resolved public URL array to persist + dispatch.
 */
async function resolveMediaUrls(
  storageService: StorageService,
  mediaUrls: string[],
): Promise<string[] | null> {
  if (mediaUrls.length === 0) return null;
  let changed = false;
  const resolved: string[] = [];
  for (const entry of mediaUrls) {
    if (isAlreadyPublicUrl(entry)) {
      resolved.push(entry);
      continue;
    }
    // Needs staging → R2 must be configured. Fail loud otherwise.
    if (!isR2StagingConfigured()) {
      throw new Error(
        `media '${entry}' is not a public URL and R2 staging is not configured`,
      );
    }
    const company = companyId();
    if (!company) {
      throw new Error("TEAM_DASHBOARD_COMPANY_ID is not set; cannot resolve internal media objectKey");
    }
    const obj = await storageService.getObject(company, entry);
    const buffer = await readStreamToBuffer(obj.stream);
    const publicUrl = await stageBufferToR2(
      buffer,
      obj.contentType ?? "application/octet-stream",
      entry,
    );
    resolved.push(publicUrl);
    changed = true;
  }
  return changed ? resolved : null;
}

interface DueRow {
  id: string;
  socialAccountId: string;
  text: string;
  mediaUrls: string[];
  altTexts: string[];
  replyToUrl: string | null;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  platform: string;
  oauthRef: string | null;
  accountStatus: string;
}

export interface RelayerResult {
  picked: number;
  posted: number;
  failed: number;
  retrying: number;
  skipped: number;
  overCap: number;
}

export async function runSocialRelayerTick(
  db: Db,
  storageService: StorageService,
): Promise<RelayerResult> {
  const result: RelayerResult = { picked: 0, posted: 0, failed: 0, retrying: 0, skipped: 0, overCap: 0 };

  const due = await db.execute(sql`
    SELECT
      sp.id,
      sp.social_account_id    AS "socialAccountId",
      sp.text,
      sp.media_urls           AS "mediaUrls",
      sp.alt_texts            AS "altTexts",
      sp.reply_to_url         AS "replyToUrl",
      sp.attempts,
      sp.max_attempts         AS "maxAttempts",
      sp.payload,
      sa.platform,
      sa.oauth_ref            AS "oauthRef",
      sa.status               AS "accountStatus"
    FROM social_posts sp
    JOIN social_accounts sa ON sa.id = sp.social_account_id
    WHERE sp.status = 'scheduled'
      AND sp.scheduled_at <= now()
    ORDER BY sp.scheduled_at ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE OF sp SKIP LOCKED
  `);

  const rows = (due as unknown as DueRow[]);
  result.picked = rows.length;
  if (rows.length === 0) return result;

  const ids = rows.map((r) => r.id);
  // Claim the picked rows by marking them 'publishing'. Bind each id as a
  // SCALAR param in a loop: drizzle expands an interpolated JS array into
  // comma-separated params, which is wrong for ANY(array) — it produced
  // `ANY(($1)::uuid[])` with $1 bound to a single uuid string and threw
  // PostgresError "malformed array literal". The scalar `${id}` form is the
  // proven-correct binding used by every other write in this file (BATCH_SIZE
  // caps this at 5 rows/tick).
  for (const id of ids) {
    await db.execute(sql`
      UPDATE social_posts
         SET status = 'publishing',
             updated_at = now()
       WHERE id = ${id}
    `);
  }

  for (const row of rows) {
    if (row.accountStatus !== "active") {
      await markFailed(db, row.id, `social_account is ${row.accountStatus}`, row.attempts + 1, row.maxAttempts);
      result.failed += 1;
      continue;
    }

    // Per-platform daily publish cap. Over cap = revert to scheduled, no
    // attempts increment, so the row retries tomorrow when count resets.
    try {
      const cap = await canPublish(db, row.platform);
      if (!cap.allowed) {
        await db.execute(sql`
          UPDATE social_posts
             SET status = 'scheduled',
                 error = 'over daily publish cap',
                 updated_at = now()
           WHERE id = ${row.id}
        `);
        result.overCap += 1;
        logger.info(
          { id: row.id, platform: row.platform, used: cap.used, cap: cap.cap },
          "social-relayer over daily publish cap, deferring",
        );
        continue;
      }
    } catch (capErr) {
      logger.warn({ err: capErr, id: row.id, platform: row.platform }, "platform-caps: canPublish threw, proceeding");
    }

    // Zernio-connected accounts (oauthRef "zernio:…") publish through Zernio for
    // every platform; only non-Zernio accounts use the native per-platform path.
    const publisher = resolvePublisher(row.platform, row.oauthRef);
    if (!publisher || !publisher.publishText) {
      await markFailed(
        db,
        row.id,
        `no text publisher registered for platform '${row.platform}'`,
        row.attempts + 1,
        row.maxAttempts,
      );
      result.failed += 1;
      continue;
    }
    if (!publisher.isConfigured()) {
      await markFailed(
        db,
        row.id,
        `publisher '${row.platform}' is not configured`,
        row.attempts + 1,
        row.maxAttempts,
      );
      result.failed += 1;
      continue;
    }

    // Resolve media to PUBLIC URLs Zernio can fetch. Non-public entries (internal
    // storage objectKeys) are staged to R2 and the resolved URLs persisted back
    // to the row so retries reuse them (no re-staging). FAIL LOUD on any failure:
    // mark the post failed; never dispatch a non-public URL. The publisher's
    // non-public-URL guard remains the backstop.
    const rowMediaUrls = Array.isArray(row.mediaUrls) ? row.mediaUrls : [];
    let mediaUrls = rowMediaUrls;
    try {
      const resolved = await resolveMediaUrls(storageService, rowMediaUrls);
      if (resolved) {
        mediaUrls = resolved;
        await db.execute(sql`
          UPDATE social_posts
             SET media_urls = ${JSON.stringify(resolved)}::jsonb,
                 updated_at = now()
           WHERE id = ${row.id}
        `);
      }
    } catch (stageErr) {
      const msg = stageErr instanceof Error ? stageErr.message : String(stageErr);
      await markFailed(db, row.id, `media staging failed: ${msg}`, row.attempts + 1, row.maxAttempts);
      result.failed += 1;
      logger.error({ id: row.id, platform: row.platform, err: stageErr }, "social-relayer media staging failed");
      continue;
    }

    // Forward the row's platform so the Zernio publisher targets the right
    // network (tiktok/youtube/x/instagram) instead of defaulting to instagram.
    // An explicit payload.platform (set by a caller) wins; native publishers
    // ignore this field.
    const basePayload = (row.payload ?? {}) as Record<string, unknown>;
    const publishPayload = {
      ...basePayload,
      platform:
        typeof basePayload.platform === "string" && basePayload.platform
          ? basePayload.platform
          : row.platform,
    };
    let publishResult: PublishResult;
    try {
      publishResult = await publisher.publishText({
        text: row.text,
        mediaUrls,
        altTexts: Array.isArray(row.altTexts) ? row.altTexts : [],
        replyToUrl: row.replyToUrl ?? undefined,
        socialAccountId: row.socialAccountId,
        oauthRef: row.oauthRef ?? undefined,
        postId: row.id,
        payload: publishPayload,
      });
    } catch (err) {
      publishResult = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (publishResult.success) {
      await db.execute(sql`
        UPDATE social_posts
           SET status = 'posted',
               attempts = ${row.attempts + 1},
               posted_url = ${publishResult.platformUrl ?? null},
               platform_post_id = ${publishResult.platformPostId ?? null},
               error = NULL,
               posted_at = now(),
               updated_at = now()
         WHERE id = ${row.id}
      `);
      await db.execute(sql`
        UPDATE social_accounts
           SET last_activity_at = now(),
               updated_at = now()
         WHERE id = ${row.socialAccountId}
      `);
      result.posted += 1;
      logger.info(
        { id: row.id, platform: row.platform, url: publishResult.platformUrl },
        "social-relayer post succeeded",
      );
    } else {
      const nextAttempts = row.attempts + 1;
      if (nextAttempts >= row.maxAttempts) {
        await markFailed(db, row.id, publishResult.error ?? "unknown error", nextAttempts, row.maxAttempts);
        result.failed += 1;
      } else {
        await db.execute(sql`
          UPDATE social_posts
             SET status = 'scheduled',
                 attempts = ${nextAttempts},
                 error = ${publishResult.error ?? null},
                 updated_at = now()
           WHERE id = ${row.id}
        `);
        result.retrying += 1;
        logger.warn(
          { id: row.id, platform: row.platform, attempts: nextAttempts, error: publishResult.error },
          "social-relayer post failed, will retry",
        );
      }
    }
  }

  return result;
}

async function markFailed(
  db: Db,
  id: string,
  error: string,
  attempts: number,
  _maxAttempts: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE social_posts
       SET status = 'failed',
           attempts = ${attempts},
           error = ${error},
           updated_at = now()
     WHERE id = ${id}
  `);
}

// ============================================================================
// Lead relayer — drains captured social_leads toward Brevo.
// (plan-zernio-leverage §2 step 6: capture → Brevo (src-tagged) → N1-N3.)
//
// Brevo stays the nurture CRM; Zernio Contacts is capture-layer only (L3
// decision). Only rows that actually carry an email are syncable — an IGSID
// alone cannot be nurtured by email, so email-less rows simply stay in the
// capture layer untouched.
// ============================================================================

const LEAD_BATCH_SIZE = 20;
const LEAD_MAX_ATTEMPTS = 5;

// Same contract as the storefront's addToBrevoList (coherencedaddy-landing
// app/api/subscribe/route.ts): POST /v3/contacts, updateEnabled so re-submits
// don't 409, SOURCE attribute for segmentation.
async function upsertBrevoContact(opts: {
  email: string;
  source: string;
  firstName: string | null;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const listId = Number(process.env.BREVO_FOUNDING_LIST_ID);
  if (!apiKey || !listId) throw new Error("Brevo not configured");
  const endpoint = process.env.BREVO_ENDPOINT || "https://api.brevo.com/v3";
  const attributes: Record<string, string> = { SOURCE: opts.source };
  if (opts.firstName) attributes.FIRSTNAME = opts.firstName;
  const res = await fetch(`${endpoint}/contacts`, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      email: opts.email,
      updateEnabled: true,
      listIds: [listId],
      attributes,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Brevo ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
}

interface DueLeadRow {
  id: string;
  email: string;
  displayName: string | null;
  keyword: string | null;
  clickTag: string | null;
  captureKind: string;
  attempts: number;
}

export interface LeadRelayerResult {
  picked: number;
  synced: number;
  failed: number;
  brevoConfigured: boolean;
}

let warnedBrevoUnconfigured = false;

export async function runLeadRelayerTick(db: Db): Promise<LeadRelayerResult> {
  const result: LeadRelayerResult = { picked: 0, synced: 0, failed: 0, brevoConfigured: true };

  if (!process.env.BREVO_API_KEY || !process.env.BREVO_FOUNDING_LIST_ID) {
    // Don't error the cron every 5 minutes over a known-unset env (that noise
    // pattern is exactly the 2026-06 cron_stale alert story) — warn once per
    // process, surface configured=false through the /leads route.
    result.brevoConfigured = false;
    if (!warnedBrevoUnconfigured) {
      warnedBrevoUnconfigured = true;
      logger.warn({}, "lead-relayer: BREVO_API_KEY / BREVO_FOUNDING_LIST_ID not set — leads accumulate unsynced");
    }
    return result;
  }

  const due = await db.execute(sql`
    SELECT
      id,
      email,
      display_name AS "displayName",
      keyword,
      click_tag    AS "clickTag",
      capture_kind AS "captureKind",
      brevo_attempts AS "attempts"
    FROM social_leads
    WHERE brevo_synced_at IS NULL
      AND email IS NOT NULL
      AND brevo_attempts < ${LEAD_MAX_ATTEMPTS}
    ORDER BY created_at ASC
    LIMIT ${LEAD_BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `);
  const rows = due as unknown as DueLeadRow[];
  result.picked = rows.length;

  for (const row of rows) {
    // src tag priority: the funnel's clickTag (ig-room / ig-coherent / ...),
    // else a keyword-derived tag, else the capture rail.
    const source =
      row.clickTag ??
      (row.keyword ? `ig-${row.keyword.toLowerCase()}` : `zernio-${row.captureKind}`);
    try {
      await upsertBrevoContact({
        email: row.email,
        source,
        firstName: row.displayName ? row.displayName.split(/\s+/)[0] : null,
      });
      await db.execute(sql`
        UPDATE social_leads
           SET brevo_synced_at = now(),
               brevo_attempts = ${row.attempts + 1},
               brevo_error = NULL,
               updated_at = now()
         WHERE id = ${row.id}
      `);
      result.synced += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.execute(sql`
        UPDATE social_leads
           SET brevo_attempts = ${row.attempts + 1},
               brevo_error = ${msg.slice(0, 500)},
               updated_at = now()
         WHERE id = ${row.id}
      `);
      result.failed += 1;
      logger.warn({ id: row.id, err }, "lead-relayer: Brevo sync failed, will retry");
    }
  }

  if (result.picked > 0) {
    logger.info(result, "lead-relayer tick");
  }
  return result;
}
