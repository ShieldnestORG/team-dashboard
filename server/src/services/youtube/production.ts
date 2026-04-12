/**
 * YouTube Pipeline — Production Orchestrator
 *
 * Runs the full pipeline: strategy → script → SEO → thumbnail → TTS → assembly → queue
 */

import type { Db } from "@paperclipai/db";
import { ytProductions, ytPublishQueue } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

import { generateContentStrategy, type ContentStrategy } from "./content-strategy.js";
import { generateScript, formatScriptForTTS, formatScriptPlainText, type ScriptData } from "./script-writer.js";
import { optimizeSEO, type SeoData } from "./seo-optimizer.js";
import { generateThumbnail, type ThumbnailResult } from "./thumbnail.js";
import { generateTTSAudio, type TTSResult } from "./tts.js";
import { assembleYouTubeVideo, generateCaptions, type YtAssembleResult } from "./yt-video-assembler.js";
import { buildSlidesFromScriptAI, buildSlidesFromScript, renderSlidesToImages, type Slide } from "./presentation-renderer.js";
import { getTemplate } from "./slide-templates.js";
import { walkSite, type SiteWalkResult } from "./site-walker.js";
import { generateWalkthroughScript } from "./walkthrough-writer.js";
import { getAvailableBackends } from "../visual-backends/index.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";
const VISUAL_MODE = process.env.YT_VISUAL_MODE || "presentation";
const ASSETS_DIR = join(process.env.YT_DATA_DIR || "/paperclip/youtube", "assets");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export interface ProductionResult {
  productionId: string;
  status: string;
  strategy: ContentStrategy;
  script: ScriptData;
  seo: SeoData;
  thumbnail: ThumbnailResult;
  tts: TTSResult;
  video?: YtAssembleResult;
  error?: string;
}

/**
 * Run the full YouTube video production pipeline.
 */
export async function runProductionPipeline(
  db: Db,
  requestedTopic?: string,
  visualMode?: string,
  templateName?: string,
): Promise<ProductionResult> {
  const mode = visualMode || VISUAL_MODE;
  const template = getTemplate(templateName);

  // 1. Generate content strategy
  logger.info("YT Pipeline: generating content strategy...");
  const strategy = await generateContentStrategy(db, requestedTopic);

  // 2. Create production record
  const [prod] = await db
    .insert(ytProductions)
    .values({
      companyId: COMPANY_ID,
      status: "processing",
      visualMode: mode,
      scheduledPublishTime: new Date(strategy.bestPublishTime),
      timeline: { created: new Date().toISOString() },
    })
    .returning({ id: ytProductions.id });

  const productionId = prod.id;

  // Site-walker state (populated if mode === "site-walker")
  let siteWalkResult: SiteWalkResult | undefined;

  try {
    // 3. Generate script (site-walker uses its own writer)
    let script: ScriptData;
    if (mode === "site-walker") {
      logger.info({ productionId, url: strategy.topic }, "YT Pipeline: walking site...");
      const walkDir = join(ASSETS_DIR, productionId, "walk");
      ensureDir(walkDir);
      siteWalkResult = await walkSite(strategy.topic, walkDir);
      logger.info({ productionId, sections: siteWalkResult.sections.length }, "YT Pipeline: generating walkthrough script...");
      script = await generateWalkthroughScript(siteWalkResult);
    } else {
      logger.info({ productionId }, "YT Pipeline: generating script...");
      script = await generateScript(strategy);
    }

    await db
      .update(ytProductions)
      .set({
        contentItemId: productionId, // self-ref for now
        strategyId: undefined, // will be set if we track it
        timeline: { created: new Date().toISOString(), scriptReady: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(ytProductions.id, productionId));

    // 4. SEO optimization
    logger.info({ productionId }, "YT Pipeline: optimizing SEO...");
    const seo = await optimizeSEO(db, script, strategy);

    await db
      .update(ytProductions)
      .set({ seoId: seo.id, updatedAt: new Date() })
      .where(eq(ytProductions.id, productionId));

    // 5. Generate thumbnail
    logger.info({ productionId }, "YT Pipeline: generating thumbnail...");
    const thumbnail = await generateThumbnail(script, seo);

    let thumbnailPath: string | undefined;
    if (thumbnail.imageBuffer) {
      ensureDir(ASSETS_DIR);
      thumbnailPath = join(ASSETS_DIR, `thumb_${productionId}.jpg`);
      await writeFile(thumbnailPath, thumbnail.imageBuffer);
    }

    // 6. Generate TTS audio
    logger.info({ productionId }, "YT Pipeline: generating TTS audio...");
    const ttsText = formatScriptForTTS(script);
    const tts = await generateTTSAudio(ttsText, `audio_${productionId}.mp3`);

    // 7. Generate visual assets (images for slideshow)
    logger.info({ productionId, mode }, "YT Pipeline: generating visual assets...");
    const { paths: visualAssets, wordCounts: slideWordCounts } = await generateVisualAssets(script, productionId, mode, siteWalkResult, template);

    // 8. Generate captions (use plain text — NOT pronunciation-mangled TTS text)
    const captionText = formatScriptPlainText(script);
    const captionsPath = await generateCaptions(captionText, tts.durationSec, `captions_${productionId}.srt`);

    // 9. Assemble video
    let video: YtAssembleResult | undefined;
    if (visualAssets.length > 0) {
      logger.info({ productionId, slides: visualAssets.length }, "YT Pipeline: assembling video...");
      video = await assembleYouTubeVideo({
        audioPath: tts.audioPath,
        audioDurationSec: tts.durationSec,
        visualAssets,
        slideWordCounts,
        captionsPath,
        outputFilename: `video_${productionId}.mp4`,
        metadata: { title: seo.title, copyright: `${new Date().getFullYear()} Tokns.fi` },
      });
    }

    // 10. Update production record
    await db
      .update(ytProductions)
      .set({
        status: video ? "ready" : "failed",
        estimatedDuration: script.duration,
        assets: {
          audioPath: tts.audioPath,
          thumbnailPath,
          videoPath: video?.videoPath,
          captionsPath,
          visualAssets,
        },
        timeline: {
          created: new Date().toISOString(),
          scriptReady: new Date().toISOString(),
          audioGenerated: new Date().toISOString(),
          videoGenerated: video ? new Date().toISOString() : undefined,
          captionsGenerated: new Date().toISOString(),
          readyForUpload: video ? new Date().toISOString() : undefined,
        },
        priority: calculatePriority(strategy),
        error: video ? undefined : "No visual assets or video assembly failed",
        updatedAt: new Date(),
      })
      .where(eq(ytProductions.id, productionId));

    // 11. Queue for publishing (if video was assembled)
    if (video) {
      await db.insert(ytPublishQueue).values({
        companyId: COMPANY_ID,
        productionId,
        title: seo.title,
        publishTime: new Date(strategy.bestPublishTime),
        priority: calculatePriority(strategy),
        metadata: {
          seoId: seo.id,
          thumbnailPath,
          videoPath: video.videoPath,
          captionsPath,
          tags: seo.tags,
          description: seo.description,
        },
      });
      logger.info({ productionId, publishTime: strategy.bestPublishTime }, "Video queued for publishing");
    }

    return { productionId, status: video ? "ready" : "failed", strategy, script, seo, thumbnail, tts, video };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(ytProductions)
      .set({ status: "failed", error: errorMsg, updatedAt: new Date() })
      .where(eq(ytProductions.id, productionId));

    logger.error({ productionId, err }, "YouTube production pipeline failed");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Visual asset generation for slideshow
// ---------------------------------------------------------------------------

interface VisualResult {
  paths: string[];
  wordCounts: number[];
}

async function generateVisualAssets(
  script: ScriptData,
  productionId: string,
  mode: string,
  walkResult?: SiteWalkResult,
  template?: import("./slide-templates.js").SlideTemplate,
): Promise<VisualResult> {
  const dir = join(ASSETS_DIR, productionId);
  ensureDir(dir);

  // ── Site-walker mode: screenshots already captured by walkSite() ──────
  if (mode === "site-walker" && walkResult) {
    const paths = walkResult.sections.map((s) => s.screenshotPath);
    const wordCounts = script.mainContent.sections.map((s) => {
      const text = Array.isArray(s.content) ? s.content.join(" ") : String(s.content);
      return Math.max(text.split(/\s+/).filter(Boolean).length, 5);
    });
    // Pad word counts to match screenshot count if needed
    while (wordCounts.length < paths.length) wordCounts.push(10);
    logger.info({ frames: paths.length }, "Site-walker screenshots ready for assembly");
    return { paths: paths.slice(0, Math.max(paths.length, wordCounts.length)), wordCounts: wordCounts.slice(0, paths.length) };
  }

  // ── Presentation mode: AI-generated slides → static fallback → AI images ─
  if (mode === "presentation") {
    // Try Ollama-generated unique slides first
    try {
      logger.info("Trying AI-generated slides via Ollama...");
      const aiSlides = await buildSlidesFromScriptAI(script, template);
      const framePaths = await renderSlidesToImages(aiSlides, dir);
      if (framePaths.length > 0) {
        const wordCounts = aiSlides.map((s: Slide) => {
          const text = s.spokenText || "";
          const words = text.split(/\s+/).filter(Boolean).length;
          if (s.type === "title" || s.type === "section_title") return Math.max(words, 3);
          return Math.max(words, 5);
        });
        logger.info({ frames: framePaths.length }, "AI-generated slides rendered successfully");
        return { paths: framePaths, wordCounts };
      }
    } catch (err) {
      logger.warn({ err }, "AI slide generation failed, trying static templates...");
    }

    // Fall back to static HTML templates
    try {
      const staticSlides = buildSlidesFromScript(script, template);
      logger.info({ slideCount: staticSlides.length }, "Built static presentation slides from script");
      const framePaths = await renderSlidesToImages(staticSlides, dir);
      if (framePaths.length > 0) {
        const wordCounts = staticSlides.map((s: Slide) => {
          const text = s.spokenText || "";
          const words = text.split(/\s+/).filter(Boolean).length;
          if (s.type === "title" || s.type === "section_title") return Math.max(words, 3);
          return Math.max(words, 5);
        });
        logger.info({ frames: framePaths.length }, "Static slides rendered successfully");
        return { paths: framePaths, wordCounts };
      }
    } catch (err) {
      logger.warn({ err }, "Static slide rendering failed, falling back to AI images");
    }
  }

  // ── Image mode (or presentation fallback): AI-generated scene images ───
  const backends = getAvailableBackends().filter((b) => b.capabilities.includes("image"));
  if (backends.length === 0) {
    logger.warn("No image backend available — video will have no visuals");
    return { paths: [], wordCounts: [] };
  }

  const prompts = extractVisualPrompts(script);
  const assets: string[] = [];

  for (let i = 0; i < prompts.length; i++) {
    let generated = false;
    for (const backend of backends) {
      try {
        const result = await backend.generateImage({
          prompt: prompts[i],
          width: 1920,
          height: 1080,
        });
        if (result.status === "ready" && result.assetBuffer) {
          const p = join(dir, `scene_${i}.png`);
          await writeFile(p, result.assetBuffer);
          assets.push(p);
          generated = true;
          break;
        }
      } catch (err) {
        logger.warn({ err, scene: i, backend: backend.name }, "Backend failed, trying next");
      }
    }
    if (!generated) {
      logger.warn({ scene: i }, "All backends failed for this scene");
    }
  }

  // Equal weight for AI images (no spoken text info)
  return { paths: assets, wordCounts: assets.map(() => 10) };
}

function extractVisualPrompts(script: ScriptData): string[] {
  const prompts: string[] = [];
  // Title slide
  prompts.push(
    `Professional YouTube video title card for "${script.title}", bold text, cinematic lighting, dark gradient background, tech aesthetic`,
  );
  // One prompt per section
  for (const section of script.mainContent.sections) {
    const visuals = section.visuals?.join(", ") || section.title;
    prompts.push(
      `YouTube video scene: ${visuals}, ${section.title}, professional, high quality, 16:9 aspect ratio, digital illustration`,
    );
  }
  // Conclusion
  prompts.push(
    "YouTube video outro card, subscribe reminder, professional dark gradient, tokns.fi branding, tech aesthetic",
  );
  return prompts;
}

function calculatePriority(strategy: ContentStrategy): number {
  let priority = 50;
  if (strategy.estimatedViews > 10000) priority += 20;
  else if (strategy.estimatedViews > 5000) priority += 10;
  const hoursUntilPublish = (new Date(strategy.bestPublishTime).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilPublish < 24) priority += 20;
  else if (hoursUntilPublish < 48) priority += 10;
  return Math.min(100, priority);
}
