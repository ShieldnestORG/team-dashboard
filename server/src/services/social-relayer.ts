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

const BATCH_SIZE = 5;

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
  accountStatus: string;
}

export interface RelayerResult {
  picked: number;
  posted: number;
  failed: number;
  retrying: number;
  skipped: number;
}

export async function runSocialRelayerTick(db: Db): Promise<RelayerResult> {
  const result: RelayerResult = { picked: 0, posted: 0, failed: 0, retrying: 0, skipped: 0 };

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

    let publishResult: PublishResult;
    try {
      publishResult = await publisher.publishText({
        text: row.text,
        mediaUrls: Array.isArray(row.mediaUrls) ? row.mediaUrls : [],
        altTexts: Array.isArray(row.altTexts) ? row.altTexts : [],
        replyToUrl: row.replyToUrl ?? undefined,
        socialAccountId: row.socialAccountId,
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
