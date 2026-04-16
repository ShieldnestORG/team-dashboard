/**
 * YouTube Pipeline — 30-day video file cleanup
 *
 * Deletes MP4, MP3, and SRT files for productions older than RETENTION_DAYS.
 * Thumbnails (.jpg) and slide images (visualAssets) are kept — they're small
 * and useful for reference. The DB record, SEO data, and analytics are never
 * touched; only the heavy binary files are removed.
 *
 * After deletion:
 *   - assets.videoPath / audioPath / captionsPath are nulled in the DB
 *   - productions.files_purged_at is set so the cron won't revisit the row
 */

import type { Db } from "@paperclipai/db";
import { ytProductions } from "@paperclipai/db";
import { and, eq, lt, isNull } from "drizzle-orm";
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";
const RETENTION_DAYS = 30;

type ProductionAssets = {
  scriptPath?: string;
  ttsPath?: string;
  audioPath?: string;
  thumbnailPath?: string;
  videoPath?: string;
  captionsPath?: string;
  visualAssets?: string[];
};

async function tryDelete(filePath: string): Promise<boolean> {
  if (!filePath) return false;
  try {
    if (existsSync(filePath)) {
      await unlink(filePath);
      return true;
    }
  } catch (err) {
    logger.warn({ err, filePath }, "YT cleanup: failed to delete file");
  }
  return false;
}

export async function cleanupOldVideoFiles(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const old = await db
    .select()
    .from(ytProductions)
    .where(
      and(
        eq(ytProductions.companyId, COMPANY_ID),
        lt(ytProductions.createdAt, cutoff),
        isNull(ytProductions.filesPurgedAt),
      ),
    );

  if (old.length === 0) return 0;

  let purged = 0;
  for (const prod of old) {
    const assets = prod.assets as ProductionAssets | null;
    if (!assets) {
      // No assets recorded — mark as purged anyway to skip on future runs
      await db
        .update(ytProductions)
        .set({ filesPurgedAt: new Date(), updatedAt: new Date() })
        .where(eq(ytProductions.id, prod.id));
      continue;
    }

    // Delete the three heavy file types; thumbnails and slides stay
    const targets = [assets.videoPath, assets.audioPath, assets.captionsPath].filter(
      (p): p is string => Boolean(p),
    );

    for (const filePath of targets) {
      await tryDelete(filePath);
    }

    // Null out the deleted paths in the assets blob
    const cleanedAssets: ProductionAssets = {
      ...assets,
      videoPath: undefined,
      audioPath: undefined,
      captionsPath: undefined,
    };

    await db
      .update(ytProductions)
      .set({
        assets: cleanedAssets,
        filesPurgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ytProductions.id, prod.id));

    purged++;
  }

  if (purged > 0) {
    logger.info({ purged, retentionDays: RETENTION_DAYS }, "YT cleanup: video files purged");
  }
  return purged;
}
