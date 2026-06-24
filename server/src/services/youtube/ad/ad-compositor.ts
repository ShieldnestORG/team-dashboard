/**
 * URL → Product-Ad pipeline — Ad Compositor (final stage).
 *
 * Takes a ShotList + per-shot AdAssets + voiceover (+ optional music) and
 * emits a 1920x1080 H.264 mp4 with brand-styled lower-third text, Ken Burns
 * on stills, fit-scale on videos, and xfade transitions between shots.
 *
 * Patterns mirror server/src/services/youtube/yt-video-assembler.ts:
 *   - shell out to ffmpeg via child_process.exec
 *   - ephemeral temp dir under /tmp
 *   - project pino logger
 *   - try/finally cleanup
 *
 * NOTE: each AdAsset.objectKey is treated as a filesystem path the running
 * process can read. Upstream (the pipeline orchestrator) is responsible for
 * staging remote storage objects to a local path before calling us, exactly
 * the same way assembleYouTubeVideo() is fed local image paths.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir, rm, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { logger } from "../../../middleware/logger.js";
import type { ShotList, AdAsset, Shot, Transition } from "./types.js";

const execAsync = promisify(exec);

// Output canvas + framerate are fixed: 1920x1080 @ 30fps H.264.
const OUT_WIDTH = 1920;
const OUT_HEIGHT = 1080;
const FPS = 30;

// Cross-fade duration for non-cut transitions. Kept short so even ~1.5s
// shots survive the overlap (xfade requires duration < both clip lengths).
const XFADE_SEC = 0.4;

// Lower-third overlay band Y position (pixels from top of 1080 canvas).
const LOWER_THIRD_Y = 880;

export interface ComposeAdOpts {
  shotList: ShotList;
  /** AdAsset[] aligned to shotList.shots; shotList.shots[i] is rendered using assets[i].
   *  For "product"/"broll": the asset's underlying file is an image OR video. For
   *  "text_card"/"cta": asset may be undefined — the compositor renders the text card
   *  from onScreenText alone. */
  assets: (AdAsset | undefined)[];
  /** Absolute path to a local voiceover audio file (mp3/wav). */
  voiceoverPath: string;
  /** Optional absolute path to a local music track (mp3/wav). If provided, the
   *  music is mixed at low volume and side-chained ducked under the VO. */
  musicPath?: string;
  /** Brand styling for text overlays. */
  brand: { primaryColor: string; fontFamily?: string; channelName?: string };
  /** Where to write the final mp4. */
  outputPath: string;
}

export interface ComposeAdResult {
  videoPath: string;
  durationSec: number;
  width: number;
  height: number;
  fileSizeBytes: number;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Best-effort lookup of a system font for drawtext. Falls back to ffmpeg's
 *  built-in font (no fontfile passed) if nothing is present — drawtext can
 *  still render without a fontfile on most builds. */
function findSystemFont(): string | null {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Normalize a hex color like "#FFAA00" or "FFAA00" → "0xFFAA00". ffmpeg color
 *  literals accept the 0x form universally. Falls back to white on bad input. */
function ffColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return m ? `0x${m[1].toUpperCase()}` : "0xFFFFFF";
}

/** Escape a single-quoted ffmpeg filtergraph string. Used for drawtext text=.
 *  Inside `text='...'`, the dangerous chars are ' \ : */
function escDrawtext(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Escape a path that appears in a filter argument (e.g. drawtext fontfile=). */
function escFilterPath(p: string): string {
  // Filter graph parser treats `:` as arg separator and `\` as escape; quote
  // the value and escape backslashes + quotes.
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Probe a media file's duration in seconds, returning 0 if it can't be read. */
async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${path}"`,
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/** Probe a video's pixel dimensions. */
async function probeDimensions(path: string): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${path}"`,
    );
    const [w, h] = stdout.trim().split(",").map((x) => parseInt(x, 10));
    return { width: w || OUT_WIDTH, height: h || OUT_HEIGHT };
  } catch {
    return { width: OUT_WIDTH, height: OUT_HEIGHT };
  }
}

/** Probe whether a file looks like a video (has a duration > 0 and a video
 *  stream that isn't a single-frame still). MJPEG/PNG/JPG appear as 1-frame
 *  streams with duration N/A — we treat them as images. */
async function isVideoFile(path: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,nb_frames,duration -of default=nw=1 "${path}"`,
    );
    const codec = /codec_name=(\w+)/.exec(stdout)?.[1] ?? "";
    const frames = parseInt(/nb_frames=(\d+)/.exec(stdout)?.[1] ?? "0", 10);
    const dur = parseFloat(/duration=([\d.]+)/.exec(stdout)?.[1] ?? "0");
    if (["mjpeg", "png", "jpeg", "jpg", "bmp", "gif", "webp"].includes(codec) && frames <= 1) {
      return false;
    }
    return dur > 0.2 || frames > 1;
  } catch {
    return false;
  }
}

/** Map AdAsset.contentType to a coarse "video" / "image" / "none" decision,
 *  with a ffprobe fallback when content-type isn't conclusive. */
async function classifyAsset(asset: AdAsset | undefined): Promise<"video" | "image" | "none"> {
  if (!asset) return "none";
  const ct = (asset.contentType || "").toLowerCase();
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("image/")) return "image";
  // Fall back to probing the file itself.
  return (await isVideoFile(asset.objectKey)) ? "video" : "image";
}

// ---------------------------------------------------------------------------
// per-shot clip rendering
// ---------------------------------------------------------------------------

/** Render one shot to a self-contained intermediate mp4 of exactly
 *  shot.durationSec seconds, 1920x1080 @ 30fps, no audio. Each kind picks
 *  the right input + video filter chain. */
async function renderShotClip(
  shot: Shot,
  asset: AdAsset | undefined,
  brand: ComposeAdOpts["brand"],
  tmpDir: string,
  fontFile: string | null,
): Promise<string> {
  const out = join(tmpDir, `shot_${shot.index.toString().padStart(3, "0")}.mp4`);
  const dur = Math.max(0.5, shot.durationSec); // clamp to keep ffmpeg happy
  const kind = await classifyAsset(asset);

  // Lower-third drawtext for the burned-in caption. Skipped on text_card/cta
  // where the whole shot IS the text.
  const captionFilter =
    shot.onScreenText && kind !== "none" && shot.kind !== "text_card" && shot.kind !== "cta"
      ? buildLowerThirdDrawtext(shot.onScreenText, brand, fontFile)
      : null;

  // Each branch builds a `-vf` filter chain that ends at 1920x1080@30fps.
  let vf: string;
  let input: string;

  if (kind === "video") {
    input = `-stream_loop -1 -i "${asset!.objectKey}"`;
    // Scale-fit to 1920x1080 with padding, force SAR=1, lock to 30fps.
    vf =
      "scale=1920:1080:force_original_aspect_ratio=decrease," +
      "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black," +
      `setsar=1,fps=${FPS}`;
    if (captionFilter) vf += "," + captionFilter;
  } else if (kind === "image") {
    // Ken Burns: zoompan slowly zooms 1.0 → 1.10 across the shot duration.
    // We pre-scale the still up so the zoom has resolution to work with, then
    // letterbox/cover-fit to 1920x1080.
    const frames = Math.round(dur * FPS);
    input = `-loop 1 -t ${dur.toFixed(3)} -i "${asset!.objectKey}"`;
    // Upscale to 3840x2160 cover-fit so zoompan has detail; then zoompan with
    // a slow 0..1 ramp; output exactly OUT_WIDTH x OUT_HEIGHT at FPS.
    vf =
      "scale=3840:2160:force_original_aspect_ratio=increase," +
      "crop=3840:2160," +
      `zoompan=z='min(zoom+0.0009,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUT_WIDTH}x${OUT_HEIGHT}:fps=${FPS}`;
    if (captionFilter) vf += "," + captionFilter;
  } else {
    // No asset → solid brand-color card. lavfi 'color' source generates the
    // background; drawtext renders the onScreenText centered. Even if
    // onScreenText is missing we still emit a card so the timeline doesn't break.
    const color = ffColor(brand.primaryColor);
    input = `-f lavfi -t ${dur.toFixed(3)} -i color=c=${color}:s=${OUT_WIDTH}x${OUT_HEIGHT}:r=${FPS}`;
    const cardText = shot.onScreenText?.trim() || brand.channelName?.trim() || "";
    vf = cardText
      ? buildCenteredCardDrawtext(cardText, fontFile)
      : "null"; // pass-through filter; ffmpeg accepts "null" as identity
  }

  // Encode this intermediate to mp4 with a clean keyframe layout so xfade
  // can seek inside it cheanply. Re-encoded later in the concat pass.
  const cmd =
    `ffmpeg -y ${input} -t ${dur.toFixed(3)} -vf "${vf}" ` +
    `-c:v libx264 -preset veryfast -pix_fmt yuv420p -r ${FPS} -an "${out}"`;
  await execAsync(cmd, { timeout: 180_000 });
  return out;
}

/** drawtext filter for a translucent lower-third caption strip. */
function buildLowerThirdDrawtext(
  text: string,
  brand: ComposeAdOpts["brand"],
  fontFile: string | null,
): string {
  const escaped = escDrawtext(text);
  const brandColor = ffColor(brand.primaryColor);
  const fontArg = fontFile ? `fontfile='${escFilterPath(fontFile)}':` : "";
  // Translucent black box behind white text with a brand-color border line
  // would require a second drawbox filter; we keep it to one drawtext using
  // box=1 + boxcolor with alpha for simplicity. Brand color is applied to
  // the text itself.
  return (
    `drawtext=${fontArg}` +
    `text='${escaped}':` +
    `fontcolor=${brandColor}:` +
    `fontsize=48:` +
    `box=1:boxcolor=black@0.55:boxborderw=24:` +
    `x=(w-text_w)/2:` +
    `y=${LOWER_THIRD_Y}`
  );
}

/** drawtext filter for a full-screen brand-card title (no asset case). */
function buildCenteredCardDrawtext(text: string, fontFile: string | null): string {
  const escaped = escDrawtext(text);
  const fontArg = fontFile ? `fontfile='${escFilterPath(fontFile)}':` : "";
  return (
    `drawtext=${fontArg}` +
    `text='${escaped}':` +
    `fontcolor=white:` +
    `fontsize=84:` +
    `box=1:boxcolor=black@0.35:boxborderw=40:` +
    `x=(w-text_w)/2:` +
    `y=(h-text_h)/2`
  );
}

// ---------------------------------------------------------------------------
// xfade chain assembly
// ---------------------------------------------------------------------------

/** Map our Transition enum to an xfade `transition=` name. cuts skip xfade. */
function xfadeName(t: Transition): string | null {
  switch (t) {
    case "fade":
      return "fade";
    case "slide":
      return "slideleft";
    case "zoom":
      return "zoomin";
    case "cut":
    default:
      return null;
  }
}

/**
 * Build the -filter_complex graph that chains N intermediate clips into a
 * single video stream, applying per-shot transitions to the *outgoing* edge
 * of each shot. Returns:
 *   - filterGraph: the filter_complex string
 *   - finalLabel:  the output label to map ("[vN]")
 *   - totalDur:    the total accumulated video duration in seconds
 *
 * Filter-graph construction (commented above the call site too):
 *   [0:v]format=yuv420p[v0];
 *   [1:v]format=yuv420p[v1];
 *   [v0][v1]xfade=transition=fade:duration=0.4:offset=<offset0>[vx1];
 *   [vx1][v2]xfade=...:offset=<offset1>[vx2];
 *   ...
 * For a "cut" transition we still must merge streams; we use xfade with
 * duration=0 (a hard cut at the seam) so the chain shape stays uniform.
 */
function buildXfadeFilterGraph(
  shotDurations: number[],
  shots: Shot[],
): { filterGraph: string; finalLabel: string; totalDur: number } {
  const parts: string[] = [];
  // Normalize each input to yuv420p so xfade doesn't choke on pixfmt mismatch.
  for (let i = 0; i < shotDurations.length; i++) {
    parts.push(`[${i}:v]format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
  }

  if (shotDurations.length === 1) {
    return {
      filterGraph: parts.join(";"),
      finalLabel: "[v0]",
      totalDur: shotDurations[0],
    };
  }

  let prevLabel = "[v0]";
  let offset = shotDurations[0];
  let totalDur = shotDurations[0];

  for (let i = 1; i < shotDurations.length; i++) {
    const transition = shots[i - 1].transitionOut;
    const xname = xfadeName(transition);
    // For very short shots, shrink the xfade so it stays < both clip durations.
    const maxXfade = Math.max(0, Math.min(shotDurations[i - 1], shotDurations[i]) - 0.1);
    const dur = xname === null ? 0 : Math.min(XFADE_SEC, maxXfade);
    const effectiveName = xname ?? "fade"; // "cut" → fade with dur=0 = hard cut
    const xfadeOffset = offset - dur;
    const outLabel = `[vx${i}]`;
    parts.push(
      `${prevLabel}[v${i}]xfade=transition=${effectiveName}:duration=${dur.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}${outLabel}`,
    );
    prevLabel = outLabel;
    // After xfade, the combined stream length = offset + next-clip-duration - dur.
    totalDur = xfadeOffset + dur + shotDurations[i];
    offset = totalDur;
  }

  return {
    filterGraph: parts.join(";"),
    finalLabel: prevLabel,
    totalDur,
  };
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------

/**
 * Compose the final ad mp4. Approach:
 *   1) Render each shot to a 1080p intermediate mp4 (image=zoompan,
 *      video=fit-scale, none=solid card). This isolates per-shot filtering
 *      from the global chain and keeps the filter_complex string tractable.
 *   2) One ffmpeg call wires those intermediates together with an xfade
 *      chain that respects each shot's transitionOut, then mixes audio:
 *      VO at full level + (optional) music ducked under VO via
 *      sidechaincompress, padded/trimmed to the video length with apad +
 *      -shortest.
 *   3) Probe the final file with ffprobe for the real duration / dims /
 *      size — never hardcoded.
 *
 * This intermediate-then-xfade design (vs. one giant filter_complex) is more
 * forgiving when a single shot fails (we get a clear per-shot error from
 * ffmpeg) and keeps the assembly graph short enough to debug.
 */
export async function composeAdVideo(opts: ComposeAdOpts): Promise<ComposeAdResult> {
  const { shotList, assets, voiceoverPath, musicPath, brand, outputPath } = opts;

  if (shotList.shots.length === 0) {
    throw new Error("composeAdVideo: shotList.shots is empty");
  }
  if (assets.length !== shotList.shots.length) {
    throw new Error(
      `composeAdVideo: assets length (${assets.length}) != shots length (${shotList.shots.length})`,
    );
  }
  if (!existsSync(voiceoverPath)) {
    throw new Error(`composeAdVideo: voiceover not found at ${voiceoverPath}`);
  }
  if (musicPath && !existsSync(musicPath)) {
    throw new Error(`composeAdVideo: music not found at ${musicPath}`);
  }

  const tmpDir = join("/tmp", `ad-compose-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });

  const fontFile = findSystemFont();
  logger.info(
    { shots: shotList.shots.length, fontFile, tmpDir, productionId: shotList.productionId },
    "ad-compositor: starting",
  );

  try {
    // ----- step 1: render per-shot intermediates -----
    const clipPaths: string[] = [];
    const clipDurations: number[] = [];
    for (let i = 0; i < shotList.shots.length; i++) {
      const shot = shotList.shots[i];
      const asset = assets[i];
      const path = await renderShotClip(shot, asset, brand, tmpDir, fontFile);
      const actualDur = await probeDuration(path);
      clipPaths.push(path);
      // Use the *actual* probed duration so the xfade offsets line up to the
      // real frame timeline rather than our requested duration.
      clipDurations.push(actualDur > 0 ? actualDur : shot.durationSec);
    }

    // ----- step 2: build the xfade chain + audio mix in one ffmpeg call -----
    //
    // FILTER GRAPH (annotated example, 3 shots, fade then cut):
    //   [0:v]format=yuv420p,setpts=PTS-STARTPTS[v0];
    //   [1:v]format=yuv420p,setpts=PTS-STARTPTS[v1];
    //   [2:v]format=yuv420p,setpts=PTS-STARTPTS[v2];
    //   [v0][v1]xfade=transition=fade:duration=0.4:offset=<d0-0.4>[vx1];
    //   [vx1][v2]xfade=transition=fade:duration=0:offset=<d0+d1-0.4>[vx2];
    // AUDIO (with music):
    //   [vo:a]asetpts=PTS-STARTPTS,apad[aV];
    //   [mu:a]volume=-12dB[aM];
    //   [aM][aV]sidechaincompress=threshold=0.05:ratio=8:attack=10:release=400[aMd];
    //   [aV][aMd]amix=inputs=2:duration=first:dropout_transition=0[aOut]
    // OR (vo only):
    //   [vo:a]apad[aOut]
    //
    const { filterGraph, finalLabel, totalDur } = buildXfadeFilterGraph(
      clipDurations,
      shotList.shots,
    );

    // Build input args + audio mix portion of the graph.
    const inputArgs: string[] = [];
    for (const p of clipPaths) inputArgs.push(`-i "${p}"`);
    const voIdx = clipPaths.length;
    inputArgs.push(`-i "${voiceoverPath}"`);
    let muIdx = -1;
    if (musicPath) {
      muIdx = clipPaths.length + 1;
      inputArgs.push(`-i "${musicPath}"`);
    }

    let audioFilter: string;
    let audioOutLabel: string;
    if (muIdx >= 0) {
      // VO full-level + music at -12dB, side-chain ducked by VO, then mixed.
      audioFilter =
        `;[${voIdx}:a]asetpts=PTS-STARTPTS,apad[aV]` +
        `;[${muIdx}:a]volume=-12dB,asetpts=PTS-STARTPTS[aM]` +
        `;[aM][aV]sidechaincompress=threshold=0.05:ratio=8:attack=10:release=400[aMd]` +
        `;[aV][aMd]amix=inputs=2:duration=first:dropout_transition=0[aOut]`;
      audioOutLabel = "[aOut]";
    } else {
      audioFilter = `;[${voIdx}:a]apad[aOut]`;
      audioOutLabel = "[aOut]";
    }

    const fullGraph = filterGraph + audioFilter;
    // -t totalDur trims the audio side to the video length; -shortest is a
    // belt-and-braces in case apad ran shorter than expected.
    const cmd =
      `ffmpeg -y ${inputArgs.join(" ")} ` +
      `-filter_complex "${fullGraph}" ` +
      `-map "${finalLabel}" -map "${audioOutLabel}" ` +
      `-c:v libx264 -preset veryfast -pix_fmt yuv420p -r ${FPS} ` +
      `-c:a aac -b:a 192k -ar 48000 ` +
      `-t ${totalDur.toFixed(3)} -shortest ` +
      `"${outputPath}"`;

    logger.debug({ cmdLen: cmd.length, totalDur }, "ad-compositor: ffmpeg compose cmd ready");
    await execAsync(cmd, { timeout: 900_000, maxBuffer: 16 * 1024 * 1024 });

    // ----- step 3: probe real output -----
    const [durationSec, { width, height }, st] = await Promise.all([
      probeDuration(outputPath),
      probeDimensions(outputPath),
      stat(outputPath),
    ]);

    logger.info(
      {
        productionId: shotList.productionId,
        outputPath,
        durationSec,
        width,
        height,
        fileSizeBytes: st.size,
        shots: shotList.shots.length,
      },
      "ad-compositor: done",
    );

    return {
      videoPath: outputPath,
      durationSec,
      width,
      height,
      fileSizeBytes: st.size,
    };
  } catch (err) {
    logger.error({ err, productionId: shotList.productionId }, "ad-compositor: failed");
    throw err;
  } finally {
    // Clean up the temp dir whether we succeeded or failed.
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
