// ---------------------------------------------------------------------------
// ElevenLabs TTS for the YouTube pipeline. fetch is mocked: these tests make no
// network calls, spend no characters, and need no real key.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const noteProviderFailure = vi.fn();
vi.mock("../services/provider-alerts.js", () => ({ noteProviderFailure: (f: unknown) => noteProviderFailure(f) }));
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

const MARK_VOICE_ID = "n45mfBjBoGc0McY8O2Aw";
let dataDir: string;
let tts: typeof import("../services/youtube/tts.js");
let toneMp3: Buffer;

type FetchCall = { url: string; init: { headers: Record<string, string>; body: string } };
let calls: FetchCall[];

function mockFetch(responder: (n: number) => Response) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: FetchCall["init"]) => {
      calls.push({ url, init });
      return responder(calls.length);
    }),
  );
}
const ok = (bytes: Buffer | string = "fake-mp3-bytes") => new Response(bytes, { status: 200 });
const bodyOf = (c: FetchCall) => JSON.parse(c.init.body) as Record<string, unknown>;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "yt-tts-test-"));
  process.env.YT_DATA_DIR = dataDir; // read at import time by tts.ts
  tts = await import("../services/youtube/tts.js");
  if (hasFfmpeg) {
    const mp3 = join(dataDir, "tone.mp3");
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ar", "44100", "-b:a", "128k", mp3]);
    toneMp3 = readFileSync(mp3);
  }
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  noteProviderFailure.mockClear();
  process.env.ELEVENLABS_VOICE_KEY = "test-voice-key";
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.YT_TTS_PROVIDER;
  delete process.env.YT_ELEVENLABS_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateElevenLabsTTS (mocked fetch)", () => {
  it("posts to Mark's voice with the mp3_44100_128 format and the xi-api-key header", async () => {
    mockFetch(() => ok());
    const out = join(dataDir, "single.mp3");
    const result = await tts.generateElevenLabsTTS("Hello there.", out);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${MARK_VOICE_ID}?output_format=mp3_44100_128`,
    );
    expect(calls[0].init.headers["xi-api-key"]).toBe("test-voice-key");
    expect(result.provider).toBe("elevenlabs");
    expect(existsSync(out)).toBe(true);
  });

  it("defaults to eleven_v3 Creative (owner's take D) and never sends neighbours, which v3 rejects", async () => {
    mockFetch(() => ok());
    await tts.generateElevenLabsTTS("Hello there.", join(dataDir, "settings.mp3"), { previousText: "Before.", nextText: "After." });
    const body = bodyOf(calls[0]);
    expect(body.text).toBe("Hello there.");
    expect(body.model_id).toBe("eleven_v3");
    expect(body.voice_settings).toEqual({ stability: 0.0, similarity_boost: 0.9, style: 0.0 });
    expect(body).not.toHaveProperty("previous_text");
    expect(body).not.toHaveProperty("next_text");
  });

  it("YT_ELEVENLABS_MODEL=eleven_multilingual_v2 uses the v2 preset and sends previous_text/next_text", async () => {
    process.env.YT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
    mockFetch(() => ok());
    await tts.generateElevenLabsTTS("Middle.", join(dataDir, "ctx.mp3"), { previousText: "Before.", nextText: "After." });
    const body = bodyOf(calls[0]);
    expect(body.model_id).toBe("eleven_multilingual_v2");
    expect(body.voice_settings).toEqual({ stability: 0.45, similarity_boost: 0.8, style: 0.0 });
    expect(body.previous_text).toBe("Before.");
    expect(body.next_text).toBe("After.");
  });

  it("an unknown YT_ELEVENLABS_MODEL fails loud before calling ElevenLabs", async () => {
    process.env.YT_ELEVENLABS_MODEL = "eleven_v9";
    mockFetch(() => ok());
    await expect(tts.generateElevenLabsTTS("Hi.", join(dataDir, "bad-model.mp3"))).rejects.toThrow(/YT_ELEVENLABS_MODEL/);
    expect(calls).toHaveLength(0);
  });

  it("with only ELEVENLABS_API_KEY set it throws naming ELEVENLABS_VOICE_KEY and never calls fetch", async () => {
    delete process.env.ELEVENLABS_VOICE_KEY;
    process.env.ELEVENLABS_API_KEY = "some-other-account-key";
    mockFetch(() => ok());
    await expect(tts.generateElevenLabsTTS("Hi.", join(dataDir, "nokey.mp3"))).rejects.toThrow(/ELEVENLABS_VOICE_KEY/);
    expect(calls).toHaveLength(0);
  });

  it("retries once on a 500 then succeeds, without raising an alert", async () => {
    mockFetch((n) => (n === 1 ? new Response("upstream down", { status: 500 }) : ok()));
    const result = await tts.generateElevenLabsTTS("Retry me.", join(dataDir, "retry.mp3"));
    expect(calls).toHaveLength(2);
    expect(result.provider).toBe("elevenlabs");
    expect(noteProviderFailure).not.toHaveBeenCalled();
  });

  it("does not retry a 4xx: alerts with status only (no body) and throws", async () => {
    mockFetch(() => new Response("secret provider detail", { status: 401 }));
    await expect(tts.generateElevenLabsTTS("Nope.", join(dataDir, "401.mp3"))).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
    expect(noteProviderFailure).toHaveBeenCalledTimes(1);
    const arg = noteProviderFailure.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({ provider: "elevenlabs", service: "youtube-tts", status: 401 });
    expect(arg).not.toHaveProperty("bodyText");
  });
});

describe("provider selection", () => {
  it("defaults to ElevenLabs and reports it as the active provider", () => {
    const status = tts.getTTSProviderStatus();
    expect(status).toHaveLength(2);
    expect(status.find((s) => s.name.startsWith("ElevenLabs"))).toMatchObject({ configured: true, active: true });
    expect(status.find((s) => s.name.startsWith("Grok"))).toMatchObject({ active: false });
  });

  it("YT_TTS_PROVIDER=grok flips the active flag", () => {
    process.env.YT_TTS_PROVIDER = "grok";
    const status = tts.getTTSProviderStatus();
    expect(status.find((s) => s.name.startsWith("ElevenLabs"))?.active).toBe(false);
    expect(status.find((s) => s.name.startsWith("Grok"))?.active).toBe(true);
  });

  it("an unknown YT_TTS_PROVIDER fails loud instead of silently picking one", async () => {
    process.env.YT_TTS_PROVIDER = "gork";
    await expect(tts.generateTTSAudio("Hi.")).rejects.toThrow(/YT_TTS_PROVIDER/);
  });
});

describe.skipIf(!hasFfmpeg)("generateChunkedTTS with ElevenLabs (mocked fetch, real ffmpeg)", () => {
  it("on v2 passes neighbouring beats as previous_text/next_text and returns a WAV with measured durations", async () => {
    process.env.YT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
    mockFetch(() => ok(toneMp3));
    const result = await tts.generateChunkedTTS(["First beat.", "Second beat.", "Third beat."], "chunked-ok.mp3");

    expect(calls).toHaveLength(3);
    const [first, middle, last] = calls.map(bodyOf);
    expect(first).not.toHaveProperty("previous_text");
    expect(first.next_text).toBe("Second beat.");
    expect(middle.previous_text).toBe("First beat.");
    expect(middle.next_text).toBe("Third beat.");
    expect(last.previous_text).toBe("Second beat.");
    expect(last).not.toHaveProperty("next_text");

    expect(result.audioPath.endsWith(".wav")).toBe(true); // caller said .mp3, content is WAV
    expect(result.provider).toBe("elevenlabs");
    expect(result.silenceGapSec).toBe(0.6);
    expect(result.contentDurations).toHaveLength(3);
    for (const d of result.contentDurations) expect(d).toBeGreaterThan(0.9);
    // durationSec = sum(content) + 2 gaps, to the sample
    const expected = result.contentDurations.reduce((a, b) => a + b, 0) + 2 * 0.6;
    expect(Math.abs(result.durationSec - expected)).toBeLessThan(0.005);
    expect(result.chunkDurations).toHaveLength(5);
  });

  it("failOnChunkError: true throws when a chunk fails", async () => {
    mockFetch(() => new Response("no", { status: 400 }));
    await expect(
      tts.generateChunkedTTS(["One.", "Two."], "chunked-fail.wav", { failOnChunkError: true }),
    ).rejects.toThrow(/chunk 1\/2 failed/);
  });

  it("by default a failed chunk becomes silence (site-walker behaviour)", async () => {
    mockFetch(() => new Response("no", { status: 400 }));
    const result = await tts.generateChunkedTTS(["One.", "Two."], "chunked-silence.wav");
    expect(result.contentDurations).toEqual([0, 0]);
    expect(Math.abs(result.durationSec - 0.6)).toBeLessThan(0.005);
  });
});
