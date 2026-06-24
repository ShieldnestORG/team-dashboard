/**
 * URL → Product-Ad pipeline — asset generation stage.
 *
 * For each Shot in a ShotList, pick the right visual backend, generate the
 * asset, persist the bytes via the StorageService, and write one yt_ad_assets
 * row. Returns AdAsset[] aligned to shotList.shots index-by-index.
 *
 * Per-shot failure is isolated — a single shot failing returns an AdAsset with
 * status="failed" rather than throwing the whole batch.
 *
 * Backend routing:
 *   product    → image backend, conditioned on productImageRef when present
 *                preference: fal → gemini → grok (any image-capable available)
 *   broll      → video backend if any enabled, else image fallback so the
 *                pipeline always produces something
 *   text_card  → no backend call (compositor draws from onScreenText)
 *   cta        → no backend call (compositor draws from onScreenText)
 *
 * Concurrency follows the SLIDE_GEN_CONCURRENCY chunked Promise.allSettled
 * pattern in presentation-renderer.ts — no p-limit dependency.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { ytAdAssets } from "@paperclipai/db";
import { logger } from "../../../middleware/logger.js";
import { getStorageService } from "../../../storage/index.js";
import type { StorageService } from "../../../storage/types.js";
import {
  getBackend,
  pickBackend,
  type VisualBackend,
  type VisualGenerationOpts,
  type VisualJobResult,
} from "../../visual-backends/index.js";
import type { AdAsset, Shot, ShotList } from "./types.js";

const DEFAULT_CONCURRENCY = 4;

// Vertical 9:16 is the canonical YT-shorts/TikTok target for this pipeline.
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_ASPECT = "9:16";

export interface GenerateAssetsOpts {
  db: Db;
  companyId: string;
  shotList: ShotList;
  /** Bounded parallelism for backend calls. Default 4. */
  concurrency?: number;
  /** Override the default singleton storage service (mainly for tests). */
  storage?: StorageService;
}

/**
 * For each Shot in the list, pick the right backend, generate the asset, store
 * it, and persist a yt_ad_assets row. Returns AdAsset[] aligned to
 * shotList.shots (index N corresponds to shotList.shots[N]). On per-shot
 * failure, returns an AdAsset with status="failed" rather than throwing.
 */
export async function generateAdAssets(
  opts: GenerateAssetsOpts,
): Promise<AdAsset[]> {
  const { db, companyId, shotList } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  // Storage is resolved via the same default singleton other callers use
  // (storage/index.ts → getStorageService). Tests can inject one via opts.
  const storage = opts.storage ?? getStorageService();

  const results: AdAsset[] = new Array(shotList.shots.length);

  // Bounded-concurrency pool — mirrors the SLIDE_GEN_CONCURRENCY block in
  // services/youtube/presentation-renderer.ts. Order is preserved because each
  // slot writes to its absolute index in `results`.
  for (let i = 0; i < shotList.shots.length; i += concurrency) {
    const slice = shotList.shots.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      slice.map((shot) =>
        processShot({
          db,
          companyId,
          productionId: shotList.productionId,
          shot,
          storage,
        }),
      ),
    );
    settled.forEach((r, j) => {
      const shot = slice[j];
      if (r.status === "fulfilled") {
        results[i + j] = r.value;
      } else {
        logger.error(
          { err: r.reason, shotIndex: shot.index },
          "Asset generation slot rejected unexpectedly",
        );
        results[i + j] = {
          shotIndex: shot.index,
          kind: shot.kind,
          backend: "unknown",
          objectKey: "",
          contentType: "",
          width: 0,
          height: 0,
          status: "failed",
        };
      }
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Per-shot driver
// ---------------------------------------------------------------------------

interface ProcessShotArgs {
  db: Db;
  companyId: string;
  productionId: string;
  shot: Shot;
  storage: StorageService;
}

async function processShot(args: ProcessShotArgs): Promise<AdAsset> {
  const { db, companyId, productionId, shot, storage } = args;

  // text_card / cta are compositor-rendered from onScreenText. Record a row
  // for accounting but skip any backend call.
  if (shot.kind === "text_card" || shot.kind === "cta") {
    const asset: AdAsset = {
      shotIndex: shot.index,
      kind: shot.kind,
      backend: "compositor",
      objectKey: "",
      contentType: "",
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      status: "ready",
    };
    try {
      await db.insert(ytAdAssets).values({
        companyId,
        productionId,
        shotIndex: shot.index,
        kind: shot.kind,
        backend: asset.backend,
        objectKey: null,
        contentType: null,
        width: asset.width,
        height: asset.height,
        status: "ready",
      });
    } catch (err) {
      logger.warn(
        { err, shotIndex: shot.index },
        "Failed to record compositor-only asset row (continuing)",
      );
    }
    return asset;
  }

  // Pick the backend per kind. For "broll" we want video, falling back to a
  // still image if no video backend is enabled.
  const wantsVideo = shot.kind === "broll";
  const backend = pickBackendForKind(shot.kind);
  if (!backend) {
    logger.warn(
      { shotIndex: shot.index, kind: shot.kind },
      "No visual backend available for shot",
    );
    return {
      shotIndex: shot.index,
      kind: shot.kind,
      backend: "none",
      objectKey: "",
      contentType: "",
      width: 0,
      height: 0,
      status: "failed",
    };
  }
  // If we wanted video but the chosen backend only supports image, we degrade
  // to a still image so the pipeline still produces something.
  const useVideo = wantsVideo && backend.capabilities.includes("video");

  // Insert the row as "pending" BEFORE the backend call so observers see
  // in-flight work even on long-running video generations.
  let rowId: string | undefined;
  try {
    const [row] = await db
      .insert(ytAdAssets)
      .values({
        companyId,
        productionId,
        shotIndex: shot.index,
        kind: shot.kind,
        backend: backend.name,
        status: "pending",
      })
      .returning({ id: ytAdAssets.id });
    rowId = row?.id;
  } catch (err) {
    logger.error(
      { err, shotIndex: shot.index },
      "Failed to insert pending yt_ad_assets row",
    );
    // We still attempt the generation, but cannot update by id later.
  }

  // Build the backend call. productImageRef (for product shots) is passed via
  // extra.referenceImageUrl — VisualGenerationOpts does not have a top-level
  // referenceImageUrl field yet; the fal backend being added in parallel is
  // expected to read either that key or extend the type. Using `extra` keeps
  // us forward-compatible without editing visual-backends/types.ts.
  const genOpts: VisualGenerationOpts = {
    prompt: shot.visualPrompt,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    aspectRatio: DEFAULT_ASPECT,
    durationSec: useVideo ? Math.max(1, Math.round(shot.durationSec)) : undefined,
  };
  if (shot.kind === "product" && shot.productImageRef) {
    genOpts.extra = { referenceImageUrl: shot.productImageRef };
  }

  let result: VisualJobResult;
  try {
    result = useVideo
      ? await backend.generateVideo(genOpts)
      : await backend.generateImage(genOpts);
  } catch (err) {
    logger.error(
      { err, shotIndex: shot.index, backend: backend.name },
      "Visual backend threw during generation",
    );
    await markFailed(db, rowId);
    return failedAsset(shot, backend.name);
  }

  // Some backends return an in-flight job (video). We only persist when bytes
  // are present. Anything else is recorded as failed for this synchronous API.
  if (result.status !== "ready" || !result.assetBuffer) {
    logger.warn(
      {
        shotIndex: shot.index,
        backend: backend.name,
        status: result.status,
        error: result.error,
      },
      "Backend did not return ready asset synchronously",
    );
    await markFailed(db, rowId);
    return failedAsset(shot, backend.name);
  }

  // Persist bytes via the same StorageService.putFile pattern used by
  // services/visual-content.ts (namespace + originalFilename + body).
  const contentType = result.contentType || (useVideo ? "video/mp4" : "image/png");
  const ext = contentType.split("/")[1] || (useVideo ? "mp4" : "png");
  const filename =
    result.filename || `yt-ad-${productionId}-shot${shot.index}.${ext}`;

  let objectKey: string;
  try {
    const stored = await storage.putFile({
      companyId,
      namespace: "youtube-ad",
      originalFilename: filename,
      contentType,
      body: result.assetBuffer,
    });
    objectKey = stored.objectKey;
  } catch (err) {
    logger.error(
      { err, shotIndex: shot.index, backend: backend.name },
      "Failed to store generated asset bytes",
    );
    await markFailed(db, rowId);
    return failedAsset(shot, backend.name);
  }

  const width = result.width ?? DEFAULT_WIDTH;
  const height = result.height ?? DEFAULT_HEIGHT;
  const durationMs = result.durationMs;

  // Flip the row to "ready" with the final metadata. No backend currently
  // reports cost — leave costCents undefined.
  try {
    if (rowId) {
      await db
        .update(ytAdAssets)
        .set({
          status: "ready",
          backend: backend.name,
          objectKey,
          contentType,
          width,
          height,
          durationMs: durationMs ?? null,
        })
        .where(eq(ytAdAssets.id, rowId));
    } else {
      // No pre-existing row (insert failed earlier) — best-effort insert now.
      await db.insert(ytAdAssets).values({
        companyId,
        productionId,
        shotIndex: shot.index,
        kind: shot.kind,
        backend: backend.name,
        objectKey,
        contentType,
        width,
        height,
        durationMs: durationMs ?? null,
        status: "ready",
      });
    }
  } catch (err) {
    logger.error(
      { err, shotIndex: shot.index },
      "Failed to update yt_ad_assets row to ready (asset bytes are stored)",
    );
  }

  return {
    shotIndex: shot.index,
    kind: shot.kind,
    backend: backend.name,
    objectKey,
    contentType,
    width,
    height,
    durationMs,
    status: "ready",
  };
}

// ---------------------------------------------------------------------------
// Backend routing
// ---------------------------------------------------------------------------

/**
 * Pick a backend for the given shot kind.
 *   product → image-capable, preferring fal → gemini → grok
 *   broll   → video-capable if any enabled, otherwise image fallback
 */
function pickBackendForKind(
  kind: Shot["kind"],
): VisualBackend | undefined {
  if (kind === "product") {
    // Explicit preference order so we use the reference-image-conditioned
    // backends when available. getBackend returns undefined if env key not set.
    return (
      getBackend("fal") ||
      getBackend("gemini") ||
      getBackend("grok") ||
      pickBackend("image")
    );
  }
  if (kind === "broll") {
    // Try video first, then any image backend as a still-frame fallback.
    return pickBackend("video") || pickBackend("image");
  }
  // text_card / cta are handled above and never reach this routing.
  return pickBackend("image");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markFailed(db: Db, rowId: string | undefined): Promise<void> {
  if (!rowId) return;
  try {
    await db
      .update(ytAdAssets)
      .set({ status: "failed" })
      .where(eq(ytAdAssets.id, rowId));
  } catch (err) {
    logger.warn({ err, rowId }, "Failed to mark yt_ad_assets row as failed");
  }
}

function failedAsset(shot: Shot, backendName: string): AdAsset {
  return {
    shotIndex: shot.index,
    kind: shot.kind,
    backend: backendName,
    objectKey: "",
    contentType: "",
    width: 0,
    height: 0,
    status: "failed",
  };
}
