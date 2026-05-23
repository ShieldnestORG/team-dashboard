/**
 * URL → product-ad pipeline orchestrator.
 *
 * Wires the ad-pipeline stages built in this directory together and reuses the
 * existing YouTube pipeline infra (TTS, yt_productions row, yt_publish_queue)
 * so an ad video flows through the same publish path as a regular video.
 *
 *   URL
 *    └─ createAdProduction()                    → productionId  (synchronous)
 *    └─ runAdPipelineForProduction()            → does the rest (async)
 *         ingest → brief → scene-plan → TTS → asset-gen → compose → queue
 *
 * The route invokes `createAdProduction` (synchronously, so the caller gets a
 * productionId immediately) then fires `runAdPipelineForProduction` as
 * background work — this avoids the 5+ min HTTP timeouts the slideshow pipeline
 * suffered from. Status is observed via the existing /api/youtube/pipeline
 * endpoint (which reads yt_productions).
 */

import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { ytProductions, ytPublishQueue } from "@paperclipai/db";

import { logger } from "../../../middleware/logger.js";
import { generateTTSAudio } from "../tts.js";
import { ingestUrl } from "./ingest.js";
import { buildCreativeBrief } from "./creative-director.js";
import { planShots } from "./scene-planner.js";
import { generateAdAssets } from "./asset-generator.js";
import { composeAdVideo } from "./ad-compositor.js";
import type { CreativeBrief, ShotList } from "./types.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";
const YT_DATA_DIR = process.env.YT_DATA_DIR || "/paperclip/youtube";
const VIDEO_DIR = join(YT_DATA_DIR, "videos");
const AD_DATA_DIR = join(YT_DATA_DIR, "ad");

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export interface AdPipelineRequest {
  /** Product/app URL to scrape and turn into an ad. */
  url: string;
  /** Target ad length in seconds. Default 30. */
  targetDurationSec?: number;
  /** Override the default company. */
  companyId?: string;
}

export interface AdPipelineCreated {
  productionId: string;
}

export interface AdPipelineResult {
  productionId: string;
  status: "ready" | "failed";
  videoPath?: string;
  durationSec?: number;
  brief?: CreativeBrief;
  shotList?: ShotList;
  error?: string;
}

/**
 * Insert the yt_productions row up front and return its id. The route awaits
 * this so it can hand the caller a productionId immediately.
 */
export async function createAdProduction(
  db: Db,
  req: AdPipelineRequest,
): Promise<AdPipelineCreated> {
  const companyId = req.companyId || COMPANY_ID;
  const [prod] = await db
    .insert(ytProductions)
    .values({
      companyId,
      status: "processing",
      visualMode: "url-ad",
      adMode: "url-ad",
      sourceUrl: req.url,
      // Placeholder: the orchestrator will overwrite this once the brief lands.
      scheduledPublishTime: new Date(Date.now() + 7 * 24 * 3600_000),
      timeline: { created: new Date().toISOString() },
    })
    .returning({ id: ytProductions.id });
  logger.info({ productionId: prod.id, url: req.url }, "Ad Pipeline: row created");
  return { productionId: prod.id };
}

/**
 * Run the full pipeline for an already-inserted production. Self-contained
 * error handling — never throws; updates yt_productions.status to "failed" on
 * any error.
 */
export async function runAdPipelineForProduction(
  db: Db,
  productionId: string,
  req: AdPipelineRequest,
): Promise<AdPipelineResult> {
  const companyId = req.companyId || COMPANY_ID;
  const targetDurationSec = req.targetDurationSec ?? 30;

  ensureDir(VIDEO_DIR);
  ensureDir(join(AD_DATA_DIR, productionId));

  try {
    // 1. Ingest the URL → ProductSnapshot.
    logger.info({ productionId, url: req.url }, "Ad Pipeline: ingest");
    const snapshot = await ingestUrl(req.url);

    // 2. Creative brief (vision LLM grounded on the product imagery).
    logger.info({ productionId }, "Ad Pipeline: brief");
    const brief = await buildCreativeBrief(snapshot);
    await db
      .update(ytProductions)
      .set({
        brief: brief as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(ytProductions.id, productionId));

    // 3. Shot list (LLM draft + deterministic duration/CTA enforcement).
    logger.info({ productionId }, "Ad Pipeline: scene plan");
    const shotList = await planShots(brief, productionId, { targetDurationSec });
    await db
      .update(ytProductions)
      .set({
        scenePlan: shotList as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(ytProductions.id, productionId));

    // 4. Voiceover. Concatenate per-shot VO lines; if the plan is text-card-only
    //    (no VO), fall back to the brief's CTA so the video always has audio.
    const voScript = shotList.shots
      .map((s) => (s.voiceover || "").trim())
      .filter((s) => s.length > 0)
      .join(" ");
    const ttsText = voScript || brief.callToAction || brief.oneLiner;
    logger.info({ productionId, chars: ttsText.length }, "Ad Pipeline: TTS");
    const tts = await generateTTSAudio(ttsText, `ad_${productionId}.mp3`);

    // 5. Per-shot asset generation (bounded parallel; product shots reference
    //    the scraped product image, b-roll uses video backend when available).
    logger.info({ productionId, shots: shotList.shots.length }, "Ad Pipeline: assets");
    const assets = await generateAdAssets({
      db,
      companyId,
      shotList,
      concurrency: 4,
    });

    // 6. Compose the final mp4 (ffmpeg: Ken Burns + transitions + text overlay
    //    + voiceover, music optional and not wired in Phase 1).
    const outputPath = join(VIDEO_DIR, `video_${productionId}.mp4`);
    logger.info({ productionId, outputPath }, "Ad Pipeline: compose");
    const composed = await composeAdVideo({
      shotList,
      assets,
      voiceoverPath: tts.audioPath,
      brand: {
        primaryColor: brief.brandColors[0] || "#111111",
        channelName: brief.productName,
      },
      outputPath,
    });

    // 7. Mark ready + insert into the existing publish queue. Title/description
    //    come from the brief so the YouTube publisher has what it needs.
    const title = `${brief.productName}: ${brief.oneLiner}`.slice(0, 100);
    const description = [brief.oneLiner, "", brief.callToAction]
      .filter(Boolean)
      .join("\n");
    const now = new Date().toISOString();

    await db
      .update(ytProductions)
      .set({
        status: "ready",
        // estimatedDuration column is text in this schema.
        estimatedDuration: composed.durationSec.toFixed(2),
        assets: {
          audioPath: tts.audioPath,
          videoPath: composed.videoPath,
          adAssets: assets,
        } as Record<string, unknown>,
        timeline: {
          created: now,
          briefReady: now,
          scenePlanReady: now,
          audioGenerated: now,
          videoGenerated: now,
          readyForUpload: now,
        } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(ytProductions.id, productionId));

    await db.insert(ytPublishQueue).values({
      companyId,
      productionId,
      title,
      // Schedule for one hour out so a caller can intervene before publish.
      publishTime: new Date(Date.now() + 60 * 60_000),
      priority: 50,
      metadata: {
        videoPath: composed.videoPath,
        description,
        tags: [],
        sourceUrl: req.url,
      },
    });

    logger.info(
      {
        productionId,
        videoPath: composed.videoPath,
        sizeMB: (composed.fileSizeBytes / 1e6).toFixed(2),
        durationSec: composed.durationSec,
      },
      "Ad Pipeline: done",
    );

    return {
      productionId,
      status: "ready",
      videoPath: composed.videoPath,
      durationSec: composed.durationSec,
      brief,
      shotList,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, productionId }, "Ad Pipeline failed");
    await db
      .update(ytProductions)
      .set({
        status: "failed",
        error: msg,
        updatedAt: new Date(),
      })
      .where(eq(ytProductions.id, productionId))
      .catch(() => undefined);
    return { productionId, status: "failed", error: msg };
  }
}
