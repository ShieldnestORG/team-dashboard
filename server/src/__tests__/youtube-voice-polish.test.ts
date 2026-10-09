// ---------------------------------------------------------------------------
// Voice polish: memecoin pronunciation + breath/room-tone trimming at clip
// edges. Needs ffmpeg/ffprobe on PATH for the audio tests (skipped, loudly
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

let dir: string;
let tts: typeof import("../services/youtube/tts.js");
let scriptWriter: typeof import("../services/youtube/script-writer.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "yt-voice-polish-"));
  process.env.YT_DATA_DIR = dir;
  mkdirSync(join(dir, "audio"), { recursive: true });
  tts = await import("../services/youtube/tts.js");
  scriptWriter = await import("../services/youtube/script-writer.js");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("applyPronunciationFixes — memecoin respelling", () => {
  it("respells meme/memes/memecoin/memecoins as whole words, preserving first-letter case", () => {
    const input = "Stop chasing every new memecoin. Memecoins and memes, not mementos.";
    expect(scriptWriter.applyPronunciationFixes(input)).toBe(
      "Stop chasing every new meem-coin. Meem-coins and meems, not mementos.",
    );
  });
});

describe.skipIf(!hasFfmpeg)("trimClipEdgesWav — breath/tone/tail trimming", () => {
  it("trims a short inhale and a quiet exhale around a loud tone", async () => {
    // 0.30 s noise @0.008 (~-42 dBFS) + 1.00 s 220 Hz sine @0.2 + 0.40 s noise @0.004.
    const wav = join(dir, "breathy.wav");
    ffmpeg([
      "-f", "lavfi", "-i", "anoisesrc=d=0.3:a=0.008:r=44100",
      "-f", "lavfi", "-i", "sine=f=220:d=1:r=44100",
      "-f", "lavfi", "-i", "anoisesrc=d=0.4:a=0.004:r=44100",
      "-filter_complex", "[1:a]volume=1.6[t];[0:a][t][2:a]concat=n=3:v=0:a=1",
      "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav,
    ]);

    const res = await tts.trimClipEdgesWav(wav);
    const dur = ffprobeDuration(wav);

    expect(dur).toBeGreaterThanOrEqual(1.14);
    expect(dur).toBeLessThanOrEqual(1.22);
    expect(res.trimmedStartSec).toBeGreaterThanOrEqual(0.2);
    expect(res.trimmedStartSec).toBeLessThanOrEqual(0.27);
    expect(res.trimmedEndSec).toBeGreaterThanOrEqual(0.24);
    expect(res.trimmedEndSec).toBeLessThanOrEqual(0.32);
  });

  it("leaves a clean 1.00 s sine unchanged (returns zeros, duration ~1.000 s)", async () => {
    const wav = join(dir, "clean.wav");
    ffmpeg(["-f", "lavfi", "-i", "sine=f=440:d=1:r=44100", "-af", "volume=1.6", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav]);

    const res = await tts.trimClipEdgesWav(wav);
    const dur = ffprobeDuration(wav);

    expect(res).toEqual({ trimmedStartSec: 0, trimmedEndSec: 0 });
    expect(Math.abs(dur - 1)).toBeLessThanOrEqual(0.002);
  });

  it("leaves an all-quiet clip unchanged (returns zeros, file still 1 s)", async () => {
    const wav = join(dir, "quiet.wav");
    ffmpeg(["-f", "lavfi", "-i", "anoisesrc=d=1:a=0.004:r=44100", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav]);

    const res = await tts.trimClipEdgesWav(wav);
    const dur = ffprobeDuration(wav);

    expect(res).toEqual({ trimmedStartSec: 0, trimmedEndSec: 0 });
    expect(Math.abs(dur - 1)).toBeLessThanOrEqual(0.002);
  });

  it("keeps a soft onset that is above the onset threshold", async () => {
    // 0.08 s noise @0.05 (~-26 dBFS) is audible speech, not breath: keep it.
    const wav = join(dir, "soft-onset.wav");
    ffmpeg([
      "-f", "lavfi", "-i", "anoisesrc=d=0.08:a=0.05:r=44100",
      "-f", "lavfi", "-i", "sine=f=220:d=1:r=44100",
      "-filter_complex", "[1:a]volume=1.6[t];[0:a][t]concat=n=2:v=0:a=1",
      "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav,
    ]);

    const res = await tts.trimClipEdgesWav(wav);
    expect(res.trimmedStartSec).toBeLessThan(0.02);
  });
});
