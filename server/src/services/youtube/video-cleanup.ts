/**
 * YouTube Pipeline — 30-day video file cleanup
 *
 * Deletes MP4, MP3, SRT, slide images (visualAssets), the thumbnail, and the
 * per-production timeline/anim-failure files for productions older than
 * RETENTION_DAYS. (Until 2026-10-10 this header said thumbnails (.jpg) and
 * slide images are kept — "they're small and useful for reference"; that
 * changed when 3,453 files / 888 MB had piled up since April. See DEV-117.)
 * The monthly review copy under <YT_DATA_DIR>/archive/ is never touched. The
 * DB record, SEO data, and analytics are never touched; only the binary files
 * are removed.
 *
 * After deletion:
 *   - assets.videoPath / audioPath / captionsPath / thumbnailPath / visualAssets are nulled in the DB
 *   - productions.files_purged_at is set so the cron won't revisit the row
 */

import type { Db } from "@paperclipai/db";
import { ytProductions } from "@paperclipai/db";
import { and, eq, lt, isNull } from "drizzle-orm";
import { unlink, rm } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";
const RETENTION_DAYS = 30;
const YT_DATA_DIR = resolve(process.env.YT_DATA_DIR || "/paperclip/youtube");
const ASSETS_DIR = join(YT_DATA_DIR, "assets");
const VIDEOS_DIR = join(YT_DATA_DIR, "videos");

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

async function tryDeleteDir(dirPath: string): Promise<boolean> {
  if (!dirPath) return false;
  try {
    if (existsSync(dirPath)) {
      await rm(dirPath, { recursive: true, force: true });
      return true;
    }
  } catch (err) {
    logger.warn({ err, dirPath }, "YT cleanup: failed to delete directory");
  }
  return false;
}

/** True when `filePath` resolves inside one of the allowed dirs (assets/, videos/). */
function isWithinAllowedDirs(filePath: string, dirs: string[]): boolean {
  const abs = resolve(filePath);
  return dirs.some((dir) => {
    const base = resolve(dir);
    return abs.startsWith(base + "/"); // strictly inside: never the folder itself
  });
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

    // Delete the three heavy file types (video/audio/captions)
    const targets = [assets.videoPath, assets.audioPath, assets.captionsPath].filter(
      (p): p is string => Boolean(p),
    );

    for (const filePath of targets) {
      await tryDelete(filePath);
    }

    // Slide images: delete every recorded path, then the whole per-production
    // folder recursively. Both are confined to <YT_DATA_DIR>/assets/.
    for (const path of assets.visualAssets ?? []) {
      if (!path) continue;
      if (!isWithinAllowedDirs(path, [ASSETS_DIR])) {
        logger.warn({ path }, "YT cleanup: skipping visual asset outside data dir");
        continue;
      }
      await tryDelete(path);
    }
    const slideFolder = join(ASSETS_DIR, prod.id);
    if (isWithinAllowedDirs(slideFolder, [ASSETS_DIR])) {
      await tryDeleteDir(slideFolder);
    }

    // Thumbnail — a stored path could point anywhere, so guard it like the slides
    if (assets.thumbnailPath) {
      if (isWithinAllowedDirs(assets.thumbnailPath, [ASSETS_DIR])) {
        await tryDelete(assets.thumbnailPath);
      } else {
        logger.warn({ path: assets.thumbnailPath }, "YT cleanup: skipping thumbnail outside data dir");
      }
    }

    // Per-production timeline and animated-render failure marker live in videos/
    const timelinePath = join(VIDEOS_DIR, `timeline_${prod.id}.json`);
    if (isWithinAllowedDirs(timelinePath, [VIDEOS_DIR])) {
      await tryDelete(timelinePath);
    }
    const animatedFailedPath = join(VIDEOS_DIR, `video_${prod.id}.animated.failed`);
    if (isWithinAllowedDirs(animatedFailedPath, [VIDEOS_DIR])) {
      await tryDelete(animatedFailedPath);
    }

    // Null out the deleted paths in the assets blob (archiveDir/scriptPath stay)
    const cleanedAssets: ProductionAssets = {
      ...assets,
      videoPath: undefined,
      audioPath: undefined,
      captionsPath: undefined,
      thumbnailPath: undefined,
      visualAssets: undefined,
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
