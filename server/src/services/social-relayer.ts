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
import { getPublisher } from "./platform-publishers/index.js";
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
const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID ?? "";

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
    if (!COMPANY_ID) {
      throw new Error("TEAM_DASHBOARD_COMPANY_ID is not set; cannot resolve internal media objectKey");
    }
    const obj = await storageService.getObject(COMPANY_ID, entry);
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
  await db.execute(sql`
    UPDATE social_posts
       SET status = 'publishing',
           updated_at = now()
     WHERE id = ANY(${ids})
  `);

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

    const publisher = getPublisher(row.platform);
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
        payload: row.payload ?? {},
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
