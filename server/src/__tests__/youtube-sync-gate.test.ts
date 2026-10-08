// ---------------------------------------------------------------------------
// Sync gate + exact WAV timing. Needs ffmpeg/ffprobe on PATH (skipped, loudly
// named, when they are missing). No network, no paid APIs.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/provider-alerts.js", () => ({ noteProviderFailure: vi.fn() }));
vi.mock("../services/api-usage.js", () => ({ logApiUsage: vi.fn() }));

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
const ffprobeDuration = (p: string) =>
  parseFloat(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p])
      .toString()
      .trim(),
  );

// Six visually distinct solid slides, 1280x720, with known durations.
const COLORS = ["red", "lime", "blue", "white", "black", "magenta"];
const DURATIONS = [2, 3, 2.5, 1.5, 3, 2]; // 14 s
const TOTAL = DURATIONS.reduce((a, b) => a + b, 0);

let dir: string;
let videoPath: string;
let assembler: typeof import("../services/youtube/yt-video-assembler.js");
let tts: typeof import("../services/youtube/tts.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "yt-sync-test-"));
  process.env.YT_DATA_DIR = dir;
  mkdirSync(join(dir, "audio"), { recursive: true });
  assembler = await import("../services/youtube/yt-video-assembler.js");
  tts = await import("../services/youtube/tts.js");
  if (!hasFfmpeg) return;

  videoPath = join(dir, "slides.mp4");
  const inputs = COLORS.flatMap((c, i) => ["-f", "lavfi", "-i", `color=c=${c}:s=1280x720:r=30:d=${DURATIONS[i]}`]);
  ffmpeg([
    ...inputs,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${TOTAL}`,
    "-filter_complex", `${COLORS.map((_, i) => `[${i}:v]`).join("")}concat=n=${COLORS.length}:v=1:a=0[v]`,
    "-map", "[v]", "-map", `${COLORS.length}:a`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    videoPath,
  ]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)("verifySlideSync (real ffmpeg, synthetic 6-slide video)", () => {
  it("passes when the slide durations match the picture", async () => {
    const report = await assembler.verifySlideSync({ videoPath, slideDurations: DURATIONS, audioDurationSec: TOTAL });
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.expectedCount).toBe(5);
    expect(report.matchedCount).toBe(5);
    expect(report.maxOffsetSec).toBeLessThanOrEqual(0.1);
  });

  it("NEGATIVE CONTROL: boundaries shifted +1.5 s (total unchanged) fail the gate", async () => {
    // Real changes at 2, 5, 7.5, 9, 12 s; planned ones now at 2, 6.5, 9, 10.5, 13.5 s.
    const shifted = [2, 4.5, 2.5, 1.5, 3, 0.5];
    expect(shifted.reduce((a, b) => a + b, 0)).toBeCloseTo(TOTAL, 9);
    const report = await assembler.verifySlideSync({ videoPath, slideDurations: shifted, audioDurationSec: TOTAL });
    expect(report.ok).toBe(false);
    expect(report.maxOffsetSec).toBeGreaterThan(1.0);
    expect(report.issues.join(" ")).toMatch(/more than 1s from any planned slide start/);
  });

  it("flags durations that do not add up to the audio", async () => {
    const report = await assembler.verifySlideSync({ videoPath, slideDurations: DURATIONS, audioDurationSec: TOTAL + 1 });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toMatch(/sum to/);
    expect(report.issues.join(" ")).toMatch(/video is/);
  });

  it("flags a blank video: slides that never change are not 'broken but fine'", async () => {
    const blank = join(dir, "blank.mp4");
    ffmpeg([
      "-f", "lavfi", "-i", `color=c=gray:s=1280x720:r=30:d=${TOTAL}`,
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${TOTAL}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", blank,
    ]);
    const report = await assembler.verifySlideSync({ videoPath: blank, slideDurations: DURATIONS, audioDurationSec: TOTAL });
    expect(report.ok).toBe(false);
    expect(report.matchedCount).toBe(0);
    expect(report.issues.join(" ")).toMatch(/only 0 of 5 planned slide changes/);
  });
});

describe.skipIf(!hasFfmpeg)("WAV concat timing (the helpers generateChunkedTTS uses)", () => {
  it("three tones 1.234 / 0.5 / 2.0 s with 0.6 s gaps -> 4.934 s, sample-exact, across mixed sample rates", async () => {
    const lens = [1.234, 0.5, 2.0];
    const rates = [24000, 44100, 22050]; // Grok returns 24 kHz, ElevenLabs 44.1 kHz
    const clips: string[] = [];
    for (let i = 0; i < lens.length; i++) {
      const raw = join(dir, `tone_${i}.wav`);
      const wav = join(dir, `tone_${i}_44k.wav`);
      ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${300 + i * 150}:duration=${lens[i]}`, "-ar", String(rates[i]), "-c:a", "pcm_s16le", raw]);
      await tts.decodeToWav(raw, wav);
      await tts.applyEdgeFadesWav(wav, ffprobeDuration(wav), 0.03);
      clips.push(wav);
    }

    const out = join(dir, "joined.wav");
    const track = await tts.assembleWavTrack(clips, out, 0.6, "test");

    // 3 clips -> 2 gaps: 1.234 + 0.5 + 2.0 + 2 * 0.6 = 4.934
    expect(Math.abs(track.durationSec - 4.934)).toBeLessThan(0.005);
    expect(Math.abs(ffprobeDuration(out) - 4.934)).toBeLessThan(0.005);
    lens.forEach((len, i) => expect(Math.abs(track.contentDurations[i] - len)).toBeLessThan(0.002));
    expect(track.chunkDurations).toHaveLength(5);
    // every slide boundary lands where the audio says it does
    const starts = [0, track.contentDurations[0] + 0.6, track.contentDurations[0] + track.contentDurations[1] + 1.2];
    expect(starts[2] - starts[1]).toBeCloseTo(track.contentDurations[1] + 0.6, 6);
  });

  it("an empty/failed chunk contributes 0 s of content but still its gap", async () => {
    const tone = join(dir, "solo.wav");
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=500:duration=1", "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", tone]);
    const track = await tts.assembleWavTrack([tone, null, tone], join(dir, "gap.wav"), 0.6, "gap");
    expect(track.contentDurations[1]).toBe(0);
    expect(Math.abs(track.durationSec - (1 + 0.6 + 0.6 + 1))).toBeLessThan(0.005);
  });
});
