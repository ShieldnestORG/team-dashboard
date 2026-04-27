/**
 * YouTube Pipeline — Production Orchestrator
 *
 * Runs the full pipeline: strategy → script → SEO → thumbnail → TTS → assembly → queue
 */

import type { Db } from "@paperclipai/db";
import { ytProductions, ytPublishQueue } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { writeFile, mkdir, copyFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

import { generateContentStrategy, type ContentStrategy } from "./content-strategy.js";
import { generateScript, formatScriptForTTS, formatScriptPlainText, applyPronunciationFixes, type ScriptData } from "./script-writer.js";
import { optimizeSEO, type SeoData } from "./seo-optimizer.js";
import { generateThumbnail, type ThumbnailResult } from "./thumbnail.js";
import { generateTTSAudio, generateChunkedTTS, type TTSResult } from "./tts.js";
import { assembleYouTubeVideo, generateCaptions, type YtAssembleResult } from "./yt-video-assembler.js";
import { buildSlidesFromScriptAI, buildSlidesFromScript, renderSlidesToImages, type Slide } from "./presentation-renderer.js";
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
): Promise<ProductionResult> {
  const mode = visualMode || VISUAL_MODE;

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

    // 6. Generate visual assets first — we need slide spokenTexts to drive
    //    chunked TTS, which is the only way to get measured (not estimated)
    //    per-slide durations. See drift-baseline-2026-04-27.json for the bug
    //    that motivated this ordering swap.
    logger.info({ productionId, mode }, "YT Pipeline: generating visual assets...");
    const { paths: visualAssets, wordCounts: slideWordCounts, spokenTexts } = await generateVisualAssets(script, productionId, mode, siteWalkResult);

    // 7. Generate TTS audio
    logger.info({ productionId }, "YT Pipeline: generating TTS audio...");
    let tts: TTSResult;
    let perSlideDurations: number[] | undefined;

    if (mode === "site-walker") {
      // Chunked TTS: one chunk per screenshot for cleaner voice output
      const ttsChunks = buildTTSChunks(script);
      const chunkedResult = await generateChunkedTTS(ttsChunks, `audio_${productionId}.mp3`);
      tts = { audioPath: chunkedResult.audioPath, durationSec: chunkedResult.durationSec, provider: chunkedResult.provider };
      // Collapse [content, silence, content, silence, ..., content] into per-slide durations
      // Each slide = its content duration + the following silence gap (if any)
      const raw = chunkedResult.chunkDurations;
      perSlideDurations = [];
      for (let i = 0; i < raw.length; i += 2) {
        const contentDur = raw[i] || 0;
        const silenceDur = raw[i + 1] || 0;
        perSlideDurations.push(contentDur + silenceDur);
      }
    } else if (spokenTexts && spokenTexts.length === visualAssets.length && spokenTexts.some((t) => t.length > 0)) {
      // Presentation mode with slide-level spoken text — chunk per slide so
      // each slide's duration is measured (ffprobe), not estimated. Eliminates
      // the cumulative word-count drift documented in the regression fixture.
      const chunks = spokenTexts.map((t) => applyPronunciationFixes(t || " "));
      const chunkedResult = await generateChunkedTTS(chunks, `audio_${productionId}.mp3`);
      tts = { audioPath: chunkedResult.audioPath, durationSec: chunkedResult.durationSec, provider: chunkedResult.provider };
      // generateChunkedTTS interleaves [chunk_0, gap, chunk_1, gap, ..., chunk_N]
      // with no trailing gap (see tts.ts:166-170). Collapse to per-slide
      // (content + following gap, last slide has no gap).
      const raw = chunkedResult.chunkDurations;
      perSlideDurations = [];
      for (let i = 0; i < chunks.length; i++) {
        const contentDur = raw[i * 2] || 0;
        const gapDur = i < chunks.length - 1 ? (raw[i * 2 + 1] || 0) : 0;
        perSlideDurations.push(contentDur + gapDur);
      }
    } else {
      // AI-image fallback path with no per-slide narration — single TTS call.
      // Drift will fall back to the legacy estimator; this path is a fallback,
      // not the production default.
      const ttsText = formatScriptForTTS(script);
      tts = await generateTTSAudio(ttsText, `audio_${productionId}.mp3`);
    }

    // 8. Generate captions. Persist to /paperclip/youtube/assets/<pid>/captions.srt
    //    (same volume as slides + audio) so the SRT survives container restarts —
    //    previously written to container /tmp/yt-temp/, which left DB rows with
    //    dangling captionsPath references after every restart.
    //
    //    BURN-IN policy: captions are only burned into the MP4 for site-walker
    //    mode (browser screenshots have no on-screen text). For presentation
    //    mode, the slide images themselves render the spoken content as the
    //    primary visual, so a second burned-in caption track is redundant and
    //    visually competes with the slide. The SRT is still generated and saved
    //    so it can be uploaded as a separate caption track via YouTube
    //    Data API (captions.insert) where viewers can toggle it on/off.
    const captionText = formatScriptPlainText(script);
    const tmpCaptionsPath = await generateCaptions(captionText, tts.durationSec, `captions_${productionId}.srt`);
    const persistentCaptionsDir = join(ASSETS_DIR, productionId);
    ensureDir(persistentCaptionsDir);
    const captionsPath = join(persistentCaptionsDir, "captions.srt");
    await copyFile(tmpCaptionsPath, captionsPath);
    const burnInCaptions = mode === "site-walker";

    // 9. Assemble video
    let video: YtAssembleResult | undefined;
    if (visualAssets.length > 0) {
      logger.info({ productionId, slides: visualAssets.length, burnInCaptions }, "YT Pipeline: assembling video...");
      video = await assembleYouTubeVideo({
        audioPath: tts.audioPath,
        audioDurationSec: tts.durationSec,
        visualAssets,
        slideWordCounts,
        slideDurations: perSlideDurations,
        captionsPath: burnInCaptions ? captionsPath : undefined,
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
  /** Per-slide narration text — present when slides come from a slide builder.
   * Absent for AI-image fallback mode. When present, callers should drive TTS
   * per slide (chunked) so slide durations are measured, not estimated. */
  spokenTexts?: string[];
}

async function generateVisualAssets(
  script: ScriptData,
  productionId: string,
  mode: string,
  walkResult?: SiteWalkResult,
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
      const aiSlides = await buildSlidesFromScriptAI(script);
      const framePaths = await renderSlidesToImages(aiSlides, dir);
      if (framePaths.length > 0) {
        const slidesUsed = aiSlides.slice(0, framePaths.length);
        const wordCounts = slidesUsed.map((s: Slide) => {
          const text = s.spokenText || "";
          const words = text.split(/\s+/).filter(Boolean).length;
          if (s.type === "title" || s.type === "section_title") return Math.max(words, 3);
          return Math.max(words, 5);
        });
        const spokenTexts = slidesUsed.map((s) => (s.spokenText || "").trim());
        logger.info({ frames: framePaths.length }, "AI-generated slides rendered successfully");
        return { paths: framePaths, wordCounts, spokenTexts };
      }
    } catch (err) {
      logger.warn({ err }, "AI slide generation failed, trying static templates...");
    }

    // Fall back to static HTML templates
    try {
      const staticSlides = buildSlidesFromScript(script);
      logger.info({ slideCount: staticSlides.length }, "Built static presentation slides from script");
      const framePaths = await renderSlidesToImages(staticSlides, dir);
      if (framePaths.length > 0) {
        const slidesUsed = staticSlides.slice(0, framePaths.length);
        const wordCounts = slidesUsed.map((s: Slide) => {
          const text = s.spokenText || "";
          const words = text.split(/\s+/).filter(Boolean).length;
          if (s.type === "title" || s.type === "section_title") return Math.max(words, 3);
          return Math.max(words, 5);
        });
        const spokenTexts = slidesUsed.map((s) => (s.spokenText || "").trim());
        logger.info({ frames: framePaths.length }, "Static slides rendered successfully");
        return { paths: framePaths, wordCounts, spokenTexts };
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

/**
 * Split a walkthrough script into TTS chunks aligned 1:1 with screenshots.
 * Chunk 0 = hook + intro + first section narration (shown over first screenshot)
 * Chunks 1..N-2 = one section each (one per screenshot)
 * Chunk N-1 = last section + conclusion + CTA (shown over last screenshot)
 */
function buildTTSChunks(script: ScriptData): string[] {
  const sections = script.mainContent?.sections || [];
  if (sections.length === 0) return [];

  const sectionTexts = sections.map((section) => {
    let text = `${section.title}. `;
    if (Array.isArray(section.content)) {
      for (const line of section.content) {
        if (typeof line === "string" && !line.startsWith("[")) {
          text += `${line} `;
        }
      }
    }
    return text.trim();
  });

  // Build intro text
  let intro = "";
  if (script.hook) intro += `${script.hook.text} `;
  if (script.introduction) {
    intro += `${script.introduction.greeting} `;
    intro += `${script.introduction.topicIntro} `;
    intro += `${script.introduction.valueProposition} `;
    intro += script.introduction.credibility;
  }

  // Build outro text
  let outro = "";
  if (script.conclusion) {
    outro += script.conclusion.recap.join(". ") + ". ";
    outro += script.conclusion.finalThought + " ";
  }
  if (script.callToAction) {
    outro += [
      script.callToAction.subscribe,
      script.callToAction.like,
      script.callToAction.comment,
    ].filter(Boolean).join(". ");
  }

  // Merge intro into first section, outro into last section
  const chunks: string[] = [];
  for (let i = 0; i < sectionTexts.length; i++) {
    let chunk = "";
    if (i === 0) chunk += intro.trim() + " ";
    chunk += sectionTexts[i];
    if (i === sectionTexts.length - 1) chunk += " " + outro.trim();
    chunks.push(applyPronunciationFixes(chunk.trim()));
  }

  return chunks;
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
