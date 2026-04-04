import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import { getEmbedding } from "./intel-embeddings.js";
import {
  getBackend,
  pickBackend,
  type VisualCapability,
} from "./visual-backends/index.js";
import {
  createJob,
  updateJob as updateJobRecord,
  setJobCompletionCallback,
  startJobPolling,
} from "./visual-jobs.js";
import type { StorageService } from "../storage/types.js";

export interface VisualAsset {
  id: string;
  type: "image" | "video" | "animation";
  objectKey: string;
  contentType: string;
  width: number;
  height: number;
  durationMs?: number;
  thumbnailKey?: string;
  byteSize: number;
}

export type VisualContentType =
  | "short_video"
  | "image_post"
  | "video_reel"
  | "animated_graphic";

export type VisualPlatform =
  | "youtube_shorts"
  | "tiktok"
  | "instagram_reels"
  | "twitter_video";

export interface VisualContentItem {
  id: string;
  agentId: string;
  contentType: VisualContentType;
  platform: VisualPlatform;
  status: "queued" | "generating" | "ready" | "published" | "failed";
  prompt: string;
  scriptText?: string;
  backend: string;
  assets: VisualAsset[];
  metadata: {
    topic: string;
    contextQuery?: string;
    model: string;
    width: number;
    height: number;
    durationSec?: number;
  };
  reviewStatus: "pending" | "approved" | "flagged";
  reviewComment?: string;
  jobId?: string;
  createdAt: string;
}

export interface VisualContentStats {
  total: number;
  byStatus: Record<string, number>;
  byPlatform: Record<string, number>;
  byAgent: Record<string, number>;
  byReviewStatus: Record<string, number>;
  byBackend: Record<string, number>;
}

export const PLATFORM_SPECS: Record<
  VisualPlatform,
  { width: number; height: number; maxDurationSec: number; aspectRatio: string }
> = {
  youtube_shorts: { width: 1080, height: 1920, maxDurationSec: 60, aspectRatio: "9:16" },
  tiktok: { width: 1080, height: 1920, maxDurationSec: 60, aspectRatio: "9:16" },
  instagram_reels: { width: 1080, height: 1920, maxDurationSec: 90, aspectRatio: "9:16" },
  twitter_video: { width: 1280, height: 720, maxDurationSec: 140, aspectRatio: "16:9" },
};

const QUEUE_PATH = join(process.cwd(), "data", "visual-content-queue.json");

function ensureDir() {
  const dir = dirname(QUEUE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readQueue(): VisualContentItem[] {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf-8")) as VisualContentItem[];
  } catch {
    return [];
  }
}

function writeQueue(items: VisualContentItem[]): void {
  ensureDir();
  writeFileSync(QUEUE_PATH, JSON.stringify(items, null, 2));
}

function updateQueueItem(id: string, updates: Partial<VisualContentItem>): void {
  const queue = readQueue();
  const idx = queue.findIndex((i) => i.id === id);
  if (idx === -1) return;
  Object.assign(queue[idx], updates);
  writeQueue(queue);
}

async function fetchContext(db: Db, topic: string, limit = 5): Promise<string> {
  try {
    const queryEmbedding = await getEmbedding(topic);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    const results = (await db.execute(sql`
      SELECT
        r.headline, r.body, r.report_type, r.company_slug, r.captured_at,
        1 - (r.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM intel_reports r
      WHERE r.embedding IS NOT NULL
      ORDER BY r.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    if (!results || results.length === 0) return "";

    return results
      .map((r) => {
        const body = typeof r.body === "string" ? r.body.slice(0, 300) : "";
        return `[${r.report_type}/${r.company_slug}] ${r.headline}\n${body}`;
      })
      .join("\n\n");
  } catch (err) {
    logger.warn({ err }, "Failed to fetch context for visual content generation");
    return "";
  }
}

function contentTypeToCapability(ct: VisualContentType): VisualCapability {
  switch (ct) {
    case "short_video":
    case "video_reel":
    case "animated_graphic":
      return "video";
    case "image_post":
      return "image";
    default:
      return "image";
  }
}

export function visualContentService(
  db: Db,
  storageService: StorageService,
  companyId: string,
) {
  setJobCompletionCallback(async (job, assetBuffer) => {
    try {
      const result = await storageService.putFile({
        companyId,
        namespace: "visual-content",
        originalFilename: `${job.type}-${job.id}.${job.assetContentType?.split("/")[1] || "bin"}`,
        contentType: job.assetContentType || "application/octet-stream",
        body: assetBuffer,
      });

      updateJobRecord(job.id, { assetObjectKey: result.objectKey });

      const asset: VisualAsset = {
        id: randomUUID(),
        type: job.type,
        objectKey: result.objectKey,
        contentType: result.contentType,
        width: job.width || 1080,
        height: job.height || 1920,
        durationMs: job.durationMs,
        byteSize: result.byteSize,
      };

      updateQueueItem(job.contentItemId, {
        status: "ready",
        assets: [asset],
      });

      logger.info(
        { jobId: job.id, objectKey: result.objectKey },
        "Visual asset stored",
      );
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Failed to store visual asset");
      updateQueueItem(job.contentItemId, { status: "failed" });
    }
  });

  async function generate(opts: {
    agentId: string;
    contentType: VisualContentType;
    platform: VisualPlatform;
    topic: string;
    prompt: string;
    scriptText?: string;
    contextQuery?: string;
    backendName?: string;
  }): Promise<{ contentItemId: string; jobId: string; status: string }> {
    const capability = contentTypeToCapability(opts.contentType);
    const backend = opts.backendName
      ? getBackend(opts.backendName)
      : pickBackend(capability);

    if (!backend) {
      throw new Error(
        `No visual backend available for ${capability}. Configure GEMINI_API_KEY or GROK_API_KEY.`,
      );
    }

    if (!backend.capabilities.includes(capability)) {
      throw new Error(`Backend ${backend.name} does not support ${capability}`);
    }

    const spec = PLATFORM_SPECS[opts.platform];

    let enrichedPrompt = opts.prompt;
    const context = await fetchContext(db, opts.contextQuery || opts.topic);
    if (context) {
      enrichedPrompt += `\n\nContext: ${context.slice(0, 500)}`;
    }

    const genFn =
      capability === "video"
        ? backend.generateVideo.bind(backend)
        : backend.generateImage.bind(backend);

    const result = await genFn({
      prompt: enrichedPrompt,
      width: spec.width,
      height: spec.height,
      durationSec: spec.maxDurationSec,
      aspectRatio: spec.aspectRatio,
    });

    const contentItemId = randomUUID();
    const item: VisualContentItem = {
      id: contentItemId,
      agentId: opts.agentId,
      contentType: opts.contentType,
      platform: opts.platform,
      status: result.status === "ready" ? "ready" : result.status === "failed" ? "failed" : "generating",
      prompt: opts.prompt,
      scriptText: opts.scriptText,
      backend: backend.name,
      assets: [],
      metadata: {
        topic: opts.topic,
        contextQuery: opts.contextQuery,
        model: backend.name,
        width: spec.width,
        height: spec.height,
        durationSec: capability === "video" ? spec.maxDurationSec : undefined,
      },
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };

    const job = createJob({
      backendName: backend.name,
      backendJobId: result.jobId,
      contentItemId,
      type: capability === "video" ? "video" : "image",
      status: result.status,
      prompt: opts.prompt,
      width: spec.width,
      height: spec.height,
    });

    item.jobId = job.id;

    if (result.status === "ready" && result.assetBuffer) {
      try {
        const stored = await storageService.putFile({
          companyId,
          namespace: "visual-content",
          originalFilename: result.filename || `visual-${contentItemId}.png`,
          contentType: result.contentType || "image/png",
          body: result.assetBuffer,
        });

        const asset: VisualAsset = {
          id: randomUUID(),
          type: "image",
          objectKey: stored.objectKey,
          contentType: stored.contentType,
          width: result.width || spec.width,
          height: result.height || spec.height,
          byteSize: stored.byteSize,
        };

        item.status = "ready";
        item.assets = [asset];
        updateJobRecord(job.id, {
          status: "ready",
          assetObjectKey: stored.objectKey,
          assetByteSize: stored.byteSize,
        });
      } catch (err) {
        logger.error({ err }, "Failed to store synchronous visual asset");
        item.status = "failed";
      }
    }

    const queue = readQueue();
    queue.push(item);
    writeQueue(queue);

    logger.info(
      {
        contentItemId,
        jobId: job.id,
        backend: backend.name,
        contentType: opts.contentType,
        platform: opts.platform,
      },
      "Visual content generation started",
    );

    return { contentItemId, jobId: job.id, status: item.status };
  }

  async function listQueue(opts: {
    status?: string;
    platform?: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<VisualContentItem[]> {
    let items = readQueue();

    if (opts.status) {
      items = items.filter(
        (i) => i.status === opts.status || i.reviewStatus === opts.status,
      );
    }
    if (opts.platform) {
      items = items.filter((i) => i.platform === opts.platform);
    }
    if (opts.agentId) {
      items = items.filter((i) => i.agentId === opts.agentId);
    }

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const offset = opts.offset || 0;
    const limit = opts.limit || 50;
    return items.slice(offset, offset + limit);
  }

  async function getItem(id: string): Promise<VisualContentItem | undefined> {
    return readQueue().find((i) => i.id === id);
  }

  async function reviewItem(
    id: string,
    reviewStatus: string,
    reviewComment?: string,
  ): Promise<void> {
    const queue = readQueue();
    const idx = queue.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`Visual content item not found: ${id}`);

    if (reviewStatus !== "approved" && reviewStatus !== "flagged") {
      throw new Error(`Invalid review status: ${reviewStatus}`);
    }

    queue[idx].reviewStatus = reviewStatus;
    if (reviewComment) queue[idx].reviewComment = reviewComment;
    if (reviewStatus === "approved") queue[idx].status = "published";
    if (reviewStatus === "flagged") queue[idx].status = "failed";

    writeQueue(queue);
    logger.info({ id, reviewStatus }, "Visual content item reviewed");
  }

  async function stats(): Promise<VisualContentStats> {
    const items = readQueue();

    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const byReviewStatus: Record<string, number> = {};
    const byBackend: Record<string, number> = {};

    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
      byAgent[item.agentId] = (byAgent[item.agentId] || 0) + 1;
      byReviewStatus[item.reviewStatus] =
        (byReviewStatus[item.reviewStatus] || 0) + 1;
      byBackend[item.backend] = (byBackend[item.backend] || 0) + 1;
    }

    return { total: items.length, byStatus, byPlatform, byAgent, byReviewStatus, byBackend };
  }

  const stopPolling = startJobPolling(15_000);

  return { generate, listQueue, getItem, reviewItem, stats, stopPolling };
}
