// ---------------------------------------------------------------------------
// runProductionPipeline, visual mode "animated": the wiring in production.ts with every
// slow or paid dependency mocked (no network, no ffmpeg, no browser, no database).
//   - animated render succeeds -> no slide rendering, no slideshow assembly, gate in "animated" mode
//   - animated render throws   -> the normal presentation path makes the video, gate in "slides" mode
//   - presentation mode        -> never touches the animated renderer
// assets.visualMode records which path made the video.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "yt-script-2026-10-06.json");

const m = vi.hoisted(() => ({
  renderAnimatedVideo: vi.fn(),
  assembleYouTubeVideo: vi.fn(),
  verifySlideSync: vi.fn(),
  renderSlidesToImages: vi.fn(),
  generateChunkedTTS: vi.fn(),
  loggerError: vi.fn(),
  scriptRef: { current: undefined as unknown },
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: m.loggerError, debug: vi.fn() },
}));
vi.mock("../services/youtube/content-strategy.js", () => ({
  generateContentStrategy: vi.fn(async () => ({
    topic: "t", angle: "a", pillar: "p", contentType: "c", estimatedViews: 100,
    bestPublishTime: new Date(Date.now() + 72 * 3600_000).toISOString(),
  })),
}));
vi.mock("../services/youtube/publish-slots.js", () => ({ nextPublishSlot: vi.fn(async () => new Date()) }));
vi.mock("../services/youtube/seo-optimizer.js", () => ({
  optimizeSEO: vi.fn(async () => ({ id: "seo-1", title: "T", description: "D", tags: [], hashtags: [], chapters: [] })),
  chaptersFromBeats: vi.fn(() => []),
  withChapters: vi.fn((d: string) => d),
}));
vi.mock("../services/youtube/thumbnail.js", () => ({ generateThumbnail: vi.fn(async () => ({})) }));
vi.mock("../services/youtube/archive.js", () => ({
  archiveProduction: vi.fn(async () => ({ dir: "/archive/x", scriptPath: "/archive/x/script.json" })),
}));
vi.mock("../services/youtube/site-walker.js", () => ({ walkSite: vi.fn() }));
vi.mock("../services/youtube/walkthrough-writer.js", () => ({ generateWalkthroughScript: vi.fn() }));
vi.mock("../services/visual-backends/index.js", () => ({ getAvailableBackends: () => [] }));
vi.mock("../services/youtube/animated-video.js", () => ({ renderAnimatedVideo: m.renderAnimatedVideo }));
vi.mock("../services/youtube/tts.js", () => ({
  generateChunkedTTS: m.generateChunkedTTS,
  generateTTSAudio: vi.fn(),
}));
vi.mock("../services/youtube/script-writer.js", async (orig) => ({
  ...(await orig<typeof import("../services/youtube/script-writer.js")>()),
  generateScript: vi.fn(async () => m.scriptRef.current),
}));
vi.mock("../services/youtube/yt-video-assembler.js", () => ({
  assembleYouTubeVideo: m.assembleYouTubeVideo,
  generateCaptions: vi.fn(async () => "/captions.srt"),
  generateChunkedCaptions: vi.fn(async () => "/captions.srt"),
  validateCaptions: vi.fn(async () => ({ ok: true })),
  verifySlideSync: m.verifySlideSync,
}));
vi.mock("../services/youtube/presentation-renderer.js", async (orig) => {
  const real = await orig<typeof import("../services/youtube/presentation-renderer.js")>();
  return {
    ...real,
    buildSlidesFromScriptAI: vi.fn(async (script: Parameters<typeof real.buildSlidesFromScript>[0]) => real.buildSlidesFromScript(script)),
    renderSlidesToImages: m.renderSlidesToImages,
  };
});

/** A drizzle-shaped fake that records every .set() and .values(). */
function makeDb() {
  const sets: Record<string, any>[] = [];
  const inserts: Record<string, any>[] = [];
  const db = {
    insert: () => ({
      values: (v: Record<string, any>) => {
        inserts.push(v);
        return Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: "prod-1" }] });
      },
    }),
    update: () => ({ set: (v: Record<string, any>) => (sets.push(v), { where: async () => undefined }) }),
    select: () => ({ from: () => ({ where: async () => [{ assets: {} }] }) }),
  };
  return { db, sets, inserts };
}

let dir: string;
let production: typeof import("../services/youtube/production.js");
let nBeats = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "yt-production-animated-test-"));
  process.env.YT_DATA_DIR = dir;
  const { sanitizeScript } = await import("../services/youtube/script-writer.js");
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
  delete raw._source;
  m.scriptRef.current = sanitizeScript(raw);
  const { buildBeats } = await import("../services/youtube/presentation-renderer.js");
  nBeats = buildBeats(m.scriptRef.current as never).length;
  production = await import("../services/youtube/production.js");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  vi.clearAllMocks();
  m.generateChunkedTTS.mockImplementation(async (chunks: string[]) => ({
    audioPath: "/audio.wav",
    durationSec: chunks.length * 3 + (chunks.length - 1) * 0.6,
    provider: "elevenlabs",
    contentDurations: chunks.map(() => 3),
    silenceGapSec: 0.6,
  }));
  m.renderSlidesToImages.mockImplementation(async (slides: unknown[]) => slides.map((_, i) => `/slides/slide_${i}.png`));
  m.assembleYouTubeVideo.mockImplementation(async () => ({ videoPath: join(dir, "videos", "assembled.mp4"), durationSec: 1, fileSizeBytes: 1 }));
  m.verifySlideSync.mockResolvedValue({ ok: true, issues: [], expectedCount: 1, detectedCount: 1, matchedCount: 1, medianOffsetSec: 0, maxOffsetSec: 0 });
  m.renderAnimatedVideo.mockImplementation(async (o: { productionId: string; outDir: string }) => ({
    videoPath: join(o.outDir, `video_${o.productionId}.mp4`),
    durationSec: 100,
    fileSizeBytes: 12345,
    warnings: [],
    aligned: 3,
    estimated: 1,
    wallSec: 1,
  }));
});

const assetsOf = (sets: Record<string, any>[]) => sets.find((s) => s.assets?.audioPath)!.assets;

describe("runProductionPipeline animated wiring", () => {
  it("animated render succeeds: no slides, no slideshow assembly, sync gate in animated mode", async () => {
    const { db, sets, inserts } = makeDb();
    const result = await production.runProductionPipeline(db as never, "topic", "animated");

    expect(m.renderAnimatedVideo).toHaveBeenCalledTimes(1);
    const opts = m.renderAnimatedVideo.mock.calls[0][0];
    expect(opts.productionId).toBe("prod-1");
    expect(opts.outDir).toBe(join(dir, "videos")); // where assembleYouTubeVideo writes
    expect(opts.audioPath).toBe("/audio.wav");
    expect(opts.beats).toHaveLength(nBeats);
    expect(opts.slideDurations).toHaveLength(nBeats);
    expect(opts.speechDurations).toEqual(Array(nBeats).fill(3));
    expect(opts.slideDurations[0]).toBeCloseTo(3.6, 9); // speech + gap
    expect(opts.slideDurations[nBeats - 1]).toBe(3); // the last beat has no gap

    expect(m.renderSlidesToImages).not.toHaveBeenCalled();
    expect(m.assembleYouTubeVideo).not.toHaveBeenCalled();
    expect(m.verifySlideSync).toHaveBeenCalledTimes(1);
    expect(m.verifySlideSync.mock.calls[0][0].mode).toBe("animated");
    expect(m.verifySlideSync.mock.calls[0][0].videoPath).toBe(join(dir, "videos", "video_prod-1.mp4"));

    expect(assetsOf(sets)).toMatchObject({ visualMode: "animated", videoPath: join(dir, "videos", "video_prod-1.mp4"), visualAssets: [] });
    expect(result.status).toBe("ready");
    expect(result.video?.fileSizeBytes).toBe(12345);
    expect(inserts.some((v) => v.productionId === "prod-1" && v.status === "pending_review")).toBe(true);
  });

  it("animated render throws: logs the error and the normal presentation path still makes the video", async () => {
    m.renderAnimatedVideo.mockRejectedValue(new Error("chromium exploded"));
    const { db, sets } = makeDb();
    const result = await production.runProductionPipeline(db as never, "topic", "animated");

    expect(m.renderAnimatedVideo).toHaveBeenCalledTimes(1);
    expect(m.loggerError).toHaveBeenCalledTimes(1);
    expect(m.loggerError.mock.calls[0][0].err.message).toBe("chromium exploded");
    expect(m.renderSlidesToImages).toHaveBeenCalledTimes(1);
    expect(m.assembleYouTubeVideo).toHaveBeenCalledTimes(1);
    expect(m.assembleYouTubeVideo.mock.calls[0][0].visualAssets).toHaveLength(nBeats);
    expect(m.verifySlideSync.mock.calls[0][0].mode).toBe("slides");
    expect(assetsOf(sets)).toMatchObject({ visualMode: "presentation-fallback", videoPath: join(dir, "videos", "assembled.mp4") });
    expect(result.status).toBe("ready");
  });

  it("presentation mode never touches the animated renderer", async () => {
    const { db, sets } = makeDb();
    const result = await production.runProductionPipeline(db as never, "topic", "presentation");
    expect(m.renderAnimatedVideo).not.toHaveBeenCalled();
    expect(m.assembleYouTubeVideo).toHaveBeenCalledTimes(1);
    expect(m.verifySlideSync.mock.calls[0][0].mode).toBe("slides");
    expect(assetsOf(sets).visualMode).toBe("presentation");
    expect(result.status).toBe("ready");
  });

  it("animated gate fails but slides gate passes: falls back to presentation slides and queues", async () => {
    m.verifySlideSync
      .mockResolvedValueOnce({ ok: false, issues: ["only 3 of 29 planned slide changes were seen"], expectedCount: 29, detectedCount: 3, matchedCount: 3, medianOffsetSec: 0, maxOffsetSec: 0 })
      .mockResolvedValueOnce({ ok: true, issues: [], expectedCount: 29, detectedCount: 29, matchedCount: 29, medianOffsetSec: 0, maxOffsetSec: 0 });
    const { db, sets, inserts } = makeDb();
    const result = await production.runProductionPipeline(db as never, "topic", "animated");

    expect(m.renderAnimatedVideo).toHaveBeenCalledTimes(1);
    expect(m.verifySlideSync).toHaveBeenCalledTimes(2);
    expect(m.verifySlideSync.mock.calls[0][0].mode).toBe("animated");
    expect(m.verifySlideSync.mock.calls[1][0].mode).toBe("slides");
    expect(m.renderSlidesToImages).toHaveBeenCalledTimes(1);
    expect(m.assembleYouTubeVideo).toHaveBeenCalledTimes(1);

    const assets = assetsOf(sets);
    expect(assets.visualMode).toBe("presentation-fallback");
    expect(assets.animatedGateIssues).toEqual(["only 3 of 29 planned slide changes were seen"]);
    expect(result.status).toBe("ready");
    expect(result.error).toBeUndefined();
    expect(inserts.some((v) => v.productionId === "prod-1" && v.status === "pending_review")).toBe(true);
  });

  it("animated gate fails AND slides gate fails: production failed, error from the second gate, no queue row", async () => {
    m.verifySlideSync
      .mockResolvedValueOnce({ ok: false, issues: ["only 3 of 29 planned slide changes were seen"], expectedCount: 29, detectedCount: 3, matchedCount: 3, medianOffsetSec: 0, maxOffsetSec: 0 })
      .mockResolvedValueOnce({ ok: false, issues: ["slides blank"], expectedCount: 29, detectedCount: 0, matchedCount: 0, medianOffsetSec: 0, maxOffsetSec: 0 });
    const { db, sets, inserts } = makeDb();
    const result = await production.runProductionPipeline(db as never, "topic", "animated");

    expect(m.verifySlideSync).toHaveBeenCalledTimes(2);
    expect(m.verifySlideSync.mock.calls[0][0].mode).toBe("animated");
    expect(m.verifySlideSync.mock.calls[1][0].mode).toBe("slides");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/slides blank/);
    expect(assetsOf(sets).visualMode).toBe("presentation-fallback");
    expect(inserts.some((v) => v.productionId === "prod-1")).toBe(false);
  });
});
