/**
 * YouTube Pipeline — monthly script/timeline archive
 *
 * Saves every production's script, timeline, slides, thumbnail and captions
 * under <YT_DATA_DIR>/archive/<YYYY-MM>/<productionId> for the owner's monthly
 * review. Unlike the heavy binaries (video/audio/captions in assets/), the
 * archive is never touched by the 30-day cleanup.
 */

import { copyFile, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export interface ArchiveInput {
  productionId: string;
  createdAt: Date;
  script: unknown; // the ScriptData object, saved as JSON
  strategy: { topic: string; angle: string; pillar: string; contentType: string };
  seo: { title: string; description?: string; tags?: string[]; hashtags?: string[]; chapters?: unknown };
  beats?: Array<{ type: string; text: string }>; // presentation beats, in order
  slideDurations?: number[]; // same length as beats when present
  speechDurations?: number[]; // measured clip lengths (contentDurations), same length
  slidePaths?: string[]; // rendered PNGs, same order as beats
  thumbnailPath?: string;
  captionsPath?: string;
  videoPath?: string;
  ttsProvider?: string;
  audioDurationSec?: number;
  syncReport?: unknown;
  status: string; // "ready" | "failed"
  error?: string;
}

/**
 * Archive root for a production: env is read at CALL time so tests can point
 * it at a temp dir before importing/calling.
 */
export function archiveDirFor(productionId: string, createdAt: Date): string {
  const year = createdAt.getUTCFullYear();
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, "0");
  return join(process.env.YT_DATA_DIR || "/paperclip/youtube", "archive", `${year}-${month}`, productionId);
}

async function copyIfExists(source: string | undefined, target: string): Promise<boolean> {
  if (!source || !existsSync(source)) return false;
  try {
    await copyFile(source, target);
    return true;
  } catch {
    return false;
  }
}

export async function archiveProduction(input: ArchiveInput): Promise<{ dir: string; scriptPath: string }> {
  const dir = archiveDirFor(input.productionId, input.createdAt);
  await mkdir(dir, { recursive: true });

  const files: string[] = [];

  // script.json — the full ScriptData object
  const scriptPath = join(dir, "script.json");
  await writeFile(scriptPath, JSON.stringify(input.script, null, 2));
  files.push("script.json");

  // timeline.json — beat start times as a running sum of slide durations
  if (input.beats && input.slideDurations && input.beats.length === input.slideDurations.length) {
    let startSec = 0;
    const beats = input.beats.map((beat, i) => {
      const entry = {
        index: i,
        type: beat.type,
        text: beat.text,
        startSec,
        durSec: input.slideDurations![i],
        speechSec: input.speechDurations && input.speechDurations[i] !== undefined ? input.speechDurations[i] : undefined,
      };
      startSec += input.slideDurations![i];
      return entry;
    });
    await writeFile(join(dir, "timeline.json"), JSON.stringify({ beats }, null, 2));
    files.push("timeline.json");
  }

  // seo.json
  await writeFile(join(dir, "seo.json"), JSON.stringify(input.seo, null, 2));
  files.push("seo.json");

  // slides/ — a copy of every existing rendered slide, base names kept
  if (input.slidePaths && input.slidePaths.length > 0) {
    const slidesDir = join(dir, "slides");
    await mkdir(slidesDir, { recursive: true });
    let copied = 0;
    for (const slidePath of input.slidePaths) {
      if (!slidePath || !existsSync(slidePath)) continue;
      const base = slidePath.split(/[\\/]/).pop();
      if (!base) continue;
      try {
        await copyFile(slidePath, join(slidesDir, base));
        copied++;
      } catch {
        // a single unreadable slide never fails the archive
      }
    }
    if (copied > 0) files.push("slides");
  }

  // thumbnail / captions — copied only when the source file exists
  if (await copyIfExists(input.thumbnailPath, join(dir, "thumbnail.jpg"))) files.push("thumbnail.jpg");
  if (await copyIfExists(input.captionsPath, join(dir, "captions.srt"))) files.push("captions.srt");

  // manifest.json — the index card for the monthly review
  files.push("manifest.json");
  const manifest = {
    productionId: input.productionId,
    createdAt: input.createdAt.toISOString(),
    status: input.status,
    error: input.error,
    title: input.seo.title,
    topic: input.strategy.topic,
    angle: input.strategy.angle,
    pillar: input.strategy.pillar,
    contentType: input.strategy.contentType,
    ttsProvider: input.ttsProvider,
    audioDurationSec: input.audioDurationSec,
    beatCount: input.beats ? input.beats.length : undefined,
    syncReport: input.syncReport,
    videoPath: input.videoPath,
    files,
  };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return { dir, scriptPath };
}