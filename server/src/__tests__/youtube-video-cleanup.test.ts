// ---------------------------------------------------------------------------
// cleanupOldVideoFiles — real filesystem in a temp YT_DATA_DIR, no network.
// process.env.YT_DATA_DIR is set BEFORE importing video-cleanup.js; its module
// constants (ASSETS_DIR / VIDEOS_DIR) read the env at import time, so the temp
// dir wins either way.
// ---------------------------------------------------------------------------

import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tmp = mkdtempSync(join(tmpdir(), "yt-cleanup-test-"));
process.env.YT_DATA_DIR = tmp;
process.env.TEAM_DASHBOARD_COMPANY_ID = "company-1";

const { cleanupOldVideoFiles } = await import("../services/youtube/video-cleanup.js");

const ASSETS_DIR = join(tmp, "assets");
const VIDEOS_DIR = join(tmp, "videos");

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeFile(rel: string, contents = "x"): string {
  const p = join(tmp, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, contents);
  return p;
}

/** Fake Db that applies the same cutoff the cron uses, then records every update's assets blob. */
function fakeDb(rows: Array<Record<string, unknown>>) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const updates: Array<{ assets: unknown }> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: async () =>
          rows.filter(
            (r) =>
              r.companyId === "company-1" &&
              r.filesPurgedAt === null &&
              (r.createdAt as Date).getTime() < cutoff,
          ),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ assets: payload.assets });
        },
      }),
    }),
  } as unknown as Parameters<typeof cleanupOldVideoFiles>[0];
  return { db, updates };
}

function oldRow(id: string, assets: Record<string, unknown>) {
  return {
    id,
    companyId: "company-1",
    createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
    filesPurgedAt: null,
    assets,
  };
}

function youngRow(id: string, assets: Record<string, unknown>) {
  return {
    id,
    companyId: "company-1",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    filesPurgedAt: null,
    assets,
  };
}

describe("cleanupOldVideoFiles", () => {
  it("purges slides, thumbnail and timeline of an old production, keeps its archive", async () => {
    const productionId = "prod-old";

    const slideFolder = join(ASSETS_DIR, productionId);
    const slide1 = join(slideFolder, "pres_000_title.png");
    const slide2 = join(slideFolder, "pres_001_content.png");
    makeFile(join("assets", productionId, "pres_000_title.png"), "png");
    makeFile(join("assets", productionId, "pres_001_content.png"), "png");

    const thumb = makeFile(join("assets", `thumb_${productionId}.jpg`), "jpg");
    const video = makeFile(join("videos", `video_${productionId}.mp4`), "mp4");
    const audio = makeFile(join("audio", `audio_${productionId}.wav`), "wav");
    const captions = makeFile(join("captions", `captions_${productionId}.srt`), "srt");
    const timeline = makeFile(join("videos", `timeline_${productionId}.json`), "{}");

    // Archive folder — the owner's monthly review copy, never purged
    const archive = join(tmp, "archive", "2026-09", productionId);
    const archiveSlide = makeFile(join("archive", "2026-09", productionId, "slides", "pres_000_title.png"), "png");

    const { db, updates } = fakeDb([
      oldRow(productionId, {
        videoPath: video,
        audioPath: audio,
        captionsPath: captions,
        thumbnailPath: thumb,
        visualAssets: [slide1, slide2],
        scriptPath: join(archive, "script.json"),
        archiveDir: archive,
      }),
    ]);

    const purged = await cleanupOldVideoFiles(db);

    expect(purged).toBe(1);

    // Pictures gone
    expect(existsSync(slide1)).toBe(false);
    expect(existsSync(slide2)).toBe(false);
    expect(existsSync(slideFolder)).toBe(false);
    expect(existsSync(thumb)).toBe(false);
    expect(existsSync(timeline)).toBe(false);

    // Heavy binaries gone (existing behaviour preserved)
    expect(existsSync(video)).toBe(false);
    expect(existsSync(audio)).toBe(false);
    expect(existsSync(captions)).toBe(false);

    // Archive folder untouched
    expect(existsSync(archive)).toBe(true);
    expect(existsSync(archiveSlide)).toBe(true);

    // Stored blob nulls the deleted keys, keeps archive pointers
    expect(updates.length).toBe(1);
    const stored = updates[0].assets as Record<string, unknown>;
    expect(stored.videoPath).toBeUndefined();
    expect(stored.audioPath).toBeUndefined();
    expect(stored.captionsPath).toBeUndefined();
    expect(stored.thumbnailPath).toBeUndefined();
    expect(stored.visualAssets).toBeUndefined();
    expect(stored.scriptPath).toBe(join(archive, "script.json"));
    expect(stored.archiveDir).toBe(archive);
  });

  it("leaves a young production untouched", async () => {
    const productionId = "prod-young";
    const slide = makeFile(join("assets", productionId, "pres_000_title.png"), "png");
    const thumb = makeFile(join("assets", `thumb_${productionId}.jpg`), "jpg");
    const timeline = makeFile(join("videos", `timeline_${productionId}.json`), "{}");

    const { db, updates } = fakeDb([
      youngRow(productionId, {
        thumbnailPath: thumb,
        visualAssets: [slide],
      }),
    ]);

    const purged = await cleanupOldVideoFiles(db);

    expect(purged).toBe(0);
    expect(existsSync(slide)).toBe(true);
    expect(existsSync(thumb)).toBe(true);
    expect(existsSync(timeline)).toBe(true);
    expect(updates.length).toBe(0);
  });

  it("skips a thumbnail path outside the data dir with a warning", async () => {
    const productionId = "prod-outside";
    const outsideThumb = makeFile(join(tmpdir(), `outside-thumb-${productionId}.jpg`), "jpg");

    const { db, updates } = fakeDb([
      oldRow(productionId, {
        thumbnailPath: outsideThumb,
        visualAssets: [],
      }),
    ]);

    const purged = await cleanupOldVideoFiles(db);

    expect(purged).toBe(1);
    expect(existsSync(outsideThumb)).toBe(true); // never deleted
    expect(updates.length).toBe(1);
    const stored = updates[0].assets as Record<string, unknown>;
    expect(stored.thumbnailPath).toBeUndefined(); // still nulled in the DB
  });
});
