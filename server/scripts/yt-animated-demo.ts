/**
 * Demo CLI for the animated YouTube scene templates (PROTOTYPE, not wired into production).
 *
 *   npx tsx server/scripts/yt-animated-demo.ts --timeline <json> --out <mp4> [--from 0 --to 60]
 *
 * Renders the timeline's beats (title, section, list, quote, end card, captions) frame by frame and prints
 * the speed achieved. If the timeline names an audio file it is muxed in, trimmed to the same window.
 * Set YT_ANIMATED_CHROMIUM (or pass --chromium) to use a specific Chromium executable.
 */

import { parseArgs } from "node:util";
import { renderAnimated } from "../src/services/youtube/animated/render.js";

const USAGE =
  "usage: npx tsx server/scripts/yt-animated-demo.ts --timeline <json> --out <mp4> [--from <sec>] [--to <sec>] [--chromium <path>]";

let values: { timeline?: string; out?: string; from?: string; to?: string; chromium?: string };
try {
  values = parseArgs({
    options: {
      timeline: { type: "string" },
      out: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      chromium: { type: "string" },
    },
    strict: true,
  }).values;
} catch (err) {
  console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  process.exit(2);
}

function seconds(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${label} must be a number of seconds, got "${raw}"\n${USAGE}`);
    process.exit(2);
  }
  return n;
}

if (!values.timeline || !values.out) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const r = await renderAnimated({
    timelinePath: values.timeline,
    outPath: values.out,
    fromSec: seconds(values.from, "--from"),
    toSec: seconds(values.to, "--to"),
    chromiumPath: values.chromium,
    log: (line) => console.log(line),
  });
  console.log(
    [
      `wrote ${r.outPath}`,
      `${r.frames} frames = ${r.clipSec.toFixed(2)} s of video${r.hasAudio ? " with audio" : " (silent)"}`,
      `${r.scenes} scenes, ${r.animations} animations, ${r.warnings.length} layout warning(s)`,
      `screenshot loop: ${r.framesPerSec.toFixed(1)} frames/s over ${r.loopSec.toFixed(1)} s`,
      `total wall time: ${r.wallSec.toFixed(1)} s`,
    ].join("\n"),
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
