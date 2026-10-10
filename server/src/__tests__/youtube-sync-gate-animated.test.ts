// ---------------------------------------------------------------------------
// Sync gate, animated mode. Same synthetic-video approach as youtube-sync-gate.test.ts
// (real ffmpeg, no network). Animated renders move the picture inside a beat on
// purpose (words lighting up), so mode "animated" does not report drifted changes,
// but it needs 90% of the planned changes seen (slides: 50%). Skipped, loudly
// named, when ffmpeg is missing.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySlideSync } from "../services/youtube/yt-video-assembler.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);

/** Solid-colour segments with an audio track: [colour, seconds][] -> mp4. */
function makeVideo(path: string, segments: Array<[string, number]>): number {
  const total = segments.reduce((a, [, d]) => a + d, 0);
  const inputs = segments.flatMap(([c, d]) => ["-f", "lavfi", "-i", `color=c=${c}:s=1280x720:r=30:d=${d}`]);
  ffmpeg([
    ...inputs,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${total}`,
    "-filter_complex", `${segments.map((_, i) => `[${i}:v]`).join("")}concat=n=${segments.length}:v=1:a=0[v]`,
    "-map", "[v]", "-map", `${segments.length}:a`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    path,
  ]);
  return total;
}

// Planned beats: 6 slides, 5 planned changes at 2, 5, 7.5, 9, 12 s.
const DURATIONS = [2, 3, 2.5, 1.5, 3, 2];
const TOTAL = DURATIONS.reduce((a, b) => a + b, 0);

let dir: string;
let exact: string; // picture changes exactly where DURATIONS plan them
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "yt-sync-animated-test-"));
  exact = join(dir, "exact.mp4");
  if (hasFfmpeg) makeVideo(exact, [["red", 2], ["lime", 3], ["blue", 2.5], ["white", 1.5], ["black", 3], ["magenta", 2]]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasFfmpeg)("verifySlideSync mode animated (real ffmpeg, synthetic video)", () => {
  it("a mid-beat picture change (a word lighting up) fails slides mode but passes animated mode", async () => {
    // Planned changes: 2, 5, 7.5, 9, 12 s. The picture also changes at 3.8 s, inside beat 2: 1.2 s from the nearest planned start (5).
    const video = join(dir, "wbw.mp4");
    makeVideo(video, [["red", 2], ["lime", 1.8], ["yellow", 1.2], ["blue", 2.5], ["white", 1.5], ["black", 3], ["magenta", 2]]);

    const slides = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL });
    expect(slides.ok).toBe(false);
    expect(slides.issues.join(" ")).toMatch(/more than 1s from any planned slide start/);

    const animated = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL, mode: "animated" });
    expect(animated.issues).toEqual([]);
    expect(animated.ok).toBe(true);
    expect(animated.expectedCount).toBe(5);
    expect(animated.matchedCount).toBe(5);
    expect(animated.detectedCount).toBe(6); // the extra change is still counted, just not held against the video
    expect(animated.maxOffsetSec).toBeGreaterThan(1.0);
  });

  it("NEGATIVE CONTROL: 4 of 5 planned changes seen is 80%: fine for slides (50%), not for animated (90%)", async () => {
    // Slides 3 and 4 share a colour, so the change planned at 9 s never happens in the picture.
    const video = join(dir, "four-of-five.mp4");
    makeVideo(video, [["red", 2], ["lime", 3], ["blue", 2.5], ["blue", 1.5], ["black", 3], ["magenta", 2]]);

    const slides = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL });
    expect(slides.issues).toEqual([]);
    expect(slides.ok).toBe(true);
    expect(slides.matchedCount).toBe(4);

    const animated = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL, mode: "animated" });
    expect(animated.matchedCount).toBe(4);
    expect(animated.ok).toBe(false);
    expect(animated.issues.join(" ")).toMatch(/only 4 of 5 planned slide changes/);
  });

  it("NEGATIVE CONTROL: boundaries shifted +1.5 s (total unchanged) still fail animated mode, on the matched share", async () => {
    const video = exact;
    const shifted = [2, 4.5, 2.5, 1.5, 3, 0.5];
    expect(shifted.reduce((a, b) => a + b, 0)).toBeCloseTo(TOTAL, 9);
    const report = await verifySlideSync({ videoPath: video, slideDurations: shifted, audioDurationSec: TOTAL, mode: "animated" });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toMatch(/planned slide changes were seen/);
  });

  it("a blank video still fails animated mode", async () => {
    const video = join(dir, "blank.mp4");
    makeVideo(video, [["gray", TOTAL]]);
    const report = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL, mode: "animated" });
    expect(report.ok).toBe(false);
    expect(report.matchedCount).toBe(0);
  });

  it("the duration checks are unchanged in animated mode: durations that do not add up to the audio fail", async () => {
    const video = exact;
    const report = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL + 1, mode: "animated" });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toMatch(/sum to/);
    expect(report.issues.join(" ")).toMatch(/video is/);
  });

  it("default mode is slides: an exact video passes in both", async () => {
    const video = exact;
    const a = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL });
    const b = await verifySlideSync({ videoPath: video, slideDurations: DURATIONS, audioDurationSec: TOTAL, mode: "animated" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(b.matchedCount).toBe(5);
  });
});
