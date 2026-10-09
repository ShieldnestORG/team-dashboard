// ---------------------------------------------------------------------------
// archiveProduction — real filesystem in a temp dir, no network, no ffmpeg.
// process.env.YT_DATA_DIR is set BEFORE importing archive.js; archiveDirFor
// reads the env at call time, so the temp dir wins either way.
// ---------------------------------------------------------------------------

import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = mkdtempSync(join(tmpdir(), "yt-archive-test-"));
process.env.YT_DATA_DIR = tmp;

const { archiveProduction } = await import("../services/youtube/archive.js");

const CREATED_AT = new Date("2026-10-08T06:00:00Z");
const STRATEGY = { topic: "local-first AI", angle: "cost", pillar: "infra", contentType: "explainer" };
const SEO = { title: "Local-First AI", tags: ["ai", "local"] };

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fakeFile(name: string, contents: string): string {
  const p = join(tmp, name);
  writeFileSync(p, contents);
  return p;
}

describe("archiveProduction", () => {
  it("writes script, timeline, slides, thumbnail, captions and an accurate manifest", async () => {
    const productionId = "prod-full";
    const slide1 = fakeFile("slide_0.png", "png-bytes-0");
    const slide2 = fakeFile("slide_1.png", "png-bytes-1");
    const thumb = fakeFile("thumb.jpg", "jpg-bytes");
    const srt = fakeFile("captions.srt", "1\n00:00:00,000 --> 00:00:02,500\nhello\n");

    const script = { title: "Local-First AI", hook: { text: "hi" } };
    const result = await archiveProduction({
      productionId,
      createdAt: CREATED_AT,
      script,
      strategy: STRATEGY,
      seo: SEO,
      beats: [
        { type: "title", text: "Local-First AI" },
        { type: "section", text: "why local" },
        { type: "cta", text: "subscribe" },
      ],
      slideDurations: [2.5, 3, 4],
      speechDurations: [1.9, 2.4, 4],
      slidePaths: [slide1, slide2],
      thumbnailPath: thumb,
      captionsPath: srt,
      videoPath: "/tmp/yt-temp/video.mp4",
      ttsProvider: "edge",
      audioDurationSec: 9.5,
      syncReport: { ok: true },
      status: "ready",
    });

    const dir = join(tmp, "archive", "2026-10", productionId);
    expect(result.dir).toBe(dir);
    expect(result.scriptPath).toBe(join(dir, "script.json"));
    expect(existsSync(dir)).toBe(true);

    // script.json round-trips
    expect(JSON.parse(readFileSync(result.scriptPath, "utf8"))).toEqual(script);

    // timeline start times are the running sum of slide durations
    const timeline = JSON.parse(readFileSync(join(dir, "timeline.json"), "utf8"));
    expect(timeline.beats.map((b: { startSec: number }) => b.startSec)).toEqual([0, 2.5, 5.5]);
    expect(timeline.beats.map((b: { durSec: number }) => b.durSec)).toEqual([2.5, 3, 4]);
    expect(timeline.beats.map((b: { speechSec: number }) => b.speechSec)).toEqual([1.9, 2.4, 4]);

    // both slides copied, base names kept
    expect(existsSync(join(dir, "slides"))).toBe(true);
    const slides = readdirSync(join(dir, "slides")).sort();
    expect(slides).toEqual(["slide_0.png", "slide_1.png"]);

    expect(existsSync(join(dir, "thumbnail.jpg"))).toBe(true);
    expect(existsSync(join(dir, "captions.srt"))).toBe(true);

    // manifest.files lists exactly the files written
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.files.sort()).toEqual(["captions.srt", "manifest.json", "script.json", "seo.json", "slides", "thumbnail.jpg", "timeline.json"]);
    expect(manifest.status).toBe("ready");
    expect(manifest.title).toBe("Local-First AI");
    expect(manifest.beatCount).toBe(3);
  });

  it("skips missing optional sources silently (no throw, nothing listed that does not exist)", async () => {
    const productionId = "prod-partial";
    const result = await archiveProduction({
      productionId,
      createdAt: CREATED_AT,
      script: { title: "x" },
      strategy: STRATEGY,
      seo: SEO,
      captionsPath: join(tmp, "does-not-exist.srt"), // missing source file
      status: "failed",
      error: "boom",
    });

    const dir = result.dir;
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "captions.srt"))).toBe(false);
    expect(existsSync(join(dir, "slides"))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.files.sort()).toEqual(["manifest.json", "script.json", "seo.json"]);
    expect(manifest.status).toBe("failed");
    expect(manifest.error).toBe("boom");
  });

  it("omits timeline.json when beats and slideDurations lengths differ", async () => {
    const productionId = "prod-mismatch";
    const result = await archiveProduction({
      productionId,
      createdAt: CREATED_AT,
      script: { title: "y" },
      strategy: STRATEGY,
      seo: SEO,
      beats: [
        { type: "a", text: "one" },
        { type: "b", text: "two" },
        { type: "c", text: "three" },
      ],
      slideDurations: [1, 2], // 3 beats vs 2 durations
      status: "ready",
    });

    expect(existsSync(join(result.dir, "timeline.json"))).toBe(false);
  });
});