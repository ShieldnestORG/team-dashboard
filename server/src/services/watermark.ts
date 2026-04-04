import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { logger } from "../middleware/logger.js";

const ASSETS_DIR = join(process.cwd(), "server", "src", "assets");
const WATERMARK_PATH = join(ASSETS_DIR, "watermark.png");

/**
 * Ensure the watermark asset exists.
 * If no watermark.png is provided, creates a simple SVG-based placeholder.
 * For production, replace server/src/assets/watermark.png with the real brand asset.
 */
export function ensureWatermark(): string {
  if (existsSync(WATERMARK_PATH)) {
    return WATERMARK_PATH;
  }

  // Create assets directory
  if (!existsSync(ASSETS_DIR)) {
    mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Create a simple SVG placeholder watermark and save as SVG
  // (FFmpeg can handle SVG input for overlays)
  const svgPath = join(ASSETS_DIR, "watermark.svg");
  if (!existsSync(svgPath)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40">
  <text x="100" y="28" font-family="Arial, sans-serif" font-size="16" font-weight="bold"
        fill="white" fill-opacity="0.7" text-anchor="middle">coherencedaddy.com</text>
</svg>`;
    writeFileSync(svgPath, svg);
    logger.info("Created placeholder watermark SVG at server/src/assets/watermark.svg");
  }

  return svgPath;
}

export function getWatermarkPath(): string {
  return existsSync(WATERMARK_PATH) ? WATERMARK_PATH : ensureWatermark();
}

/** Standard metadata for Coherence Daddy branded content */
export function brandMetadata(opts: {
  title: string;
  topic: string;
  hashtags?: string[];
}): {
  title: string;
  description: string;
  comment: string;
  copyright: string;
  keywords: string;
} {
  return {
    title: opts.title,
    description: `Trend analysis by Coherence Daddy AI — coherencedaddy.com`,
    comment: "coherencedaddy.com/reels",
    copyright: "Coherence Daddy",
    keywords: [opts.topic, ...(opts.hashtags || []), "coherencedaddy", "trends"].join(","),
  };
}
