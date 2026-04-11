/**
 * YouTube Pipeline — Thumbnail Generator service
 *
 * Uses Ollama to generate image prompts, then delegates to
 * the existing visual backends (Gemini/Grok) for actual image generation.
 */

import { callOllamaChat } from "../ollama-client.js";
import { pickBackend, type VisualGenerationOpts } from "../visual-backends/index.js";
import { logger } from "../../middleware/logger.js";
import type { ScriptData } from "./script-writer.js";
import type { SeoData } from "./seo-optimizer.js";

export interface ThumbnailResult {
  imagePath?: string;
  imageBuffer?: Buffer;
  prompt: string;
  dimensions: { width: number; height: number };
  provider: string;
}

/**
 * Generate a YouTube thumbnail for a video.
 *
 * 1. Ollama generates an optimized image prompt from the script
 * 2. Visual backend (Gemini/Grok) generates the actual image
 */
export async function generateThumbnail(
  script: ScriptData,
  seo: SeoData,
): Promise<ThumbnailResult> {
  // Step 1: Generate an optimized thumbnail prompt via Ollama
  let imagePrompt: string;
  try {
    const result = await callOllamaChat(
      [
        {
          role: "system",
          content:
            "You generate image prompts for YouTube thumbnails. Return ONLY the image prompt, nothing else. The prompt should describe a visually striking, click-worthy thumbnail image. Do NOT include any text or words in the image description — text overlays are added separately. Focus on: bold colors, dramatic lighting, relevant objects/symbols, high contrast. Style: professional YouTube thumbnail, 16:9 aspect ratio.",
        },
        {
          role: "user",
          content: `Generate a thumbnail image prompt for a YouTube video titled: "${seo.title}"\n\nVideo topic: ${script.keywords.join(", ")}`,
        },
      ],
      { temperature: 0.9, maxTokens: 200 },
    );
    imagePrompt = result.content.trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    logger.warn({ err: e }, "Ollama thumbnail prompt failed, using default");
    imagePrompt = `Professional YouTube thumbnail for "${seo.title}", bold dramatic lighting, high contrast, cinematic style, 16:9 aspect ratio, digital art`;
  }

  // Step 2: Generate image via visual backend
  const backend = pickBackend("image");
  if (!backend) {
    logger.warn("No image backend available for thumbnail generation");
    return {
      prompt: imagePrompt,
      dimensions: { width: 1280, height: 720 },
      provider: "none",
    };
  }

  try {
    const opts: VisualGenerationOpts = {
      prompt: imagePrompt,
      width: 1280,
      height: 720,
    };
    const result = await backend.generateImage(opts);

    if (result.status === "ready" && result.assetBuffer) {
      logger.info({ backend: backend.name }, "Thumbnail generated via visual backend");
      return {
        imageBuffer: result.assetBuffer,
        prompt: imagePrompt,
        dimensions: { width: result.width || 1280, height: result.height || 720 },
        provider: backend.name,
      };
    }
  } catch (err) {
    logger.error({ err, backend: backend.name }, "Visual backend thumbnail generation failed");
  }

  return {
    prompt: imagePrompt,
    dimensions: { width: 1280, height: 720 },
    provider: "none",
  };
}
