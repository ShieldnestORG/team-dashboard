/**
 * YouTube Pipeline — Publish Queue processor
 *
 * Processes the yt_publish_queue table, publishing due items via the YouTube publisher.
 */

import type { Db } from "@paperclipai/db";
import { ytPublishQueue, ytProductions } from "@paperclipai/db";
import { eq, lte, and, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { youtubePublisher } from "../platform-publishers/youtube.js";
import { sanitizeTags } from "./seo-optimizer.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

/**
 * Process the publish queue — publish all items that are due.
 */
export async function processPublishQueue(db: Db): Promise<number> {
  const now = new Date();
  const dueItems = await db
    .select()
    .from(ytPublishQueue)
    .where(
      and(
        eq(ytPublishQueue.companyId, COMPANY_ID),
        eq(ytPublishQueue.status, "scheduled"),
        lte(ytPublishQueue.publishTime, now),
      ),
    )
    .orderBy(ytPublishQueue.priority)
    .limit(5);

  if (dueItems.length === 0) return 0;

  let published = 0;
  for (const item of dueItems) {
    try {
      await publishItem(db, item);
      published++;
    } catch (err) {
      logger.error({ err, queueId: item.id }, "Failed to publish queued item");
      await db
        .update(ytPublishQueue)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(ytPublishQueue.id, item.id));
    }
  }

  logger.info({ published, total: dueItems.length }, "Publish queue processed");
  return published;
}

async function publishItem(db: Db, item: typeof ytPublishQueue.$inferSelect): Promise<void> {
  if (!youtubePublisher.isConfigured()) {
    throw new Error("YouTube API credentials not configured");
  }

  const meta = item.metadata as Record<string, unknown> | null;
  const videoPath = (meta?.videoPath as string) || "";
  const thumbnailPath = (meta?.thumbnailPath as string) || "";
  const captionsPath = (meta?.captionsPath as string) || "";
  const tags = sanitizeTags((meta?.tags as string[]) || []);
  const description = (meta?.description as string) || "";

  if (!videoPath || !existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const videoBuffer = await readFile(videoPath);

  // Mark as publishing
  await db
    .update(ytPublishQueue)
    .set({ status: "publishing" })
    .where(eq(ytPublishQueue.id, item.id));

  const result = await youtubePublisher.publish({
    assetBuffer: videoBuffer,
    contentType: "video/mp4",
    title: item.title.slice(0, 100),
    description,
    hashtags: tags.map((t) => `#${t.replace(/\s+/g, "")}`),
  });

  if (!result.success) {
    throw new Error(result.error || "YouTube publish failed");
  }

  // Update queue entry
  await db
    .update(ytPublishQueue)
    .set({
      status: "published",
      youtubeVideoId: result.platformPostId,
      youtubeUrl: result.platformUrl,
      publishedAt: new Date(),
    })
    .where(eq(ytPublishQueue.id, item.id));

  // Update production status
  await db
    .update(ytProductions)
    .set({
      status: "published",
      timeline: sql`jsonb_set(COALESCE(timeline, '{}'::jsonb), '{published}', to_jsonb(NOW()::text))`,
      updatedAt: new Date(),
    })
    .where(eq(ytProductions.id, item.productionId));

  logger.info(
    { videoId: result.platformPostId, url: result.platformUrl, title: item.title },
    "YouTube video published",
  );
}

/**
 * Force-publish a specific queue item immediately.
 */
export async function forcePublish(db: Db, queueId: string): Promise<void> {
  const [item] = await db
    .select()
    .from(ytPublishQueue)
    .where(eq(ytPublishQueue.id, queueId))
    .limit(1);

  if (!item) throw new Error(`Queue item not found: ${queueId}`);
  await publishItem(db, item);
}
