import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { visualContentItems, visualContentAssets } from "@paperclipai/db";
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
  companyId: string;
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
  publishedAt?: string | null;
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

// ---------------------------------------------------------------------------
// Map DB rows to VisualContentItem
// ---------------------------------------------------------------------------

function rowToVisualItem(
  row: typeof visualContentItems.$inferSelect,
  assetRows: Array<typeof visualContentAssets.$inferSelect>,
): VisualContentItem {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId ?? "",
    contentType: row.contentType as VisualContentType,
    platform: row.platform as VisualPlatform,
    status: row.status as VisualContentItem["status"],
    prompt: row.prompt,
    scriptText: row.scriptText ?? undefined,
    backend: row.backend ?? "",
    assets: assetRows.map((a) => ({
      id: a.id,
      type: a.type as VisualAsset["type"],
      objectKey: a.objectKey,
      contentType: a.contentType,
      width: a.width ?? 0,
      height: a.height ?? 0,
      durationMs: a.durationMs ?? undefined,
      thumbnailKey: a.thumbnailKey ?? undefined,
      byteSize: a.byteSize ?? 0,
    })),
    metadata: {
      topic: (meta.topic as string) ?? "",
      contextQuery: (meta.contextQuery as string) ?? undefined,
      model: (meta.model as string) ?? "",
      width: (meta.width as number) ?? 0,
      height: (meta.height as number) ?? 0,
      durationSec: (meta.durationSec as number) ?? undefined,
    },
    reviewStatus: row.reviewStatus as VisualContentItem["reviewStatus"],
    reviewComment: row.reviewComment ?? undefined,
    jobId: row.jobId ?? undefined,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DEFAULT_COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

export function visualContentService(
  db: Db,
  storageService: StorageService,
  companyId: string,
) {
  const resolvedCompanyId = companyId === "default" ? DEFAULT_COMPANY_ID : companyId;

  // Helper to update a DB row (replaces updateQueueItem)
  async function updateItem(id: string, updates: Record<string, unknown>): Promise<void> {
    await db
      .update(visualContentItems)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(visualContentItems.id, id));
  }

  setJobCompletionCallback(async (job, assetBuffer) => {
    try {
      const result = await storageService.putFile({
        companyId: resolvedCompanyId,
        namespace: "visual-content",
        originalFilename: `${job.type}-${job.id}.${job.assetContentType?.split("/")[1] || "bin"}`,
        contentType: job.assetContentType || "application/octet-stream",
        body: assetBuffer,
      });

      updateJobRecord(job.id, { assetObjectKey: result.objectKey });

      // Insert asset row
      await db.insert(visualContentAssets).values({
        visualContentItemId: job.contentItemId,
        type: job.type,
        objectKey: result.objectKey,
        contentType: result.contentType,
        width: job.width || 1080,
        height: job.height || 1920,
        durationMs: job.durationMs,
        byteSize: result.byteSize,
      });

      await updateItem(job.contentItemId, { status: "ready" });

      logger.info(
        { jobId: job.id, objectKey: result.objectKey },
        "Visual asset stored in DB",
      );
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Failed to store visual asset");
      await updateItem(job.contentItemId, { status: "failed" });
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
    const itemStatus = result.status === "ready" ? "ready" : result.status === "failed" ? "failed" : "generating";

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

    // Insert item into DB
    const [row] = await db.insert(visualContentItems).values({
      id: contentItemId,
      companyId: resolvedCompanyId,
      agentId: opts.agentId,
      contentType: opts.contentType,
      platform: opts.platform,
      status: itemStatus,
      prompt: opts.prompt,
      scriptText: opts.scriptText ?? null,
      backend: backend.name,
      metadata: {
        topic: opts.topic,
        contextQuery: opts.contextQuery,
        model: backend.name,
        width: spec.width,
        height: spec.height,
        durationSec: capability === "video" ? spec.maxDurationSec : undefined,
      },
      reviewStatus: "pending",
      jobId: job.id,
    }).returning();

    // Handle sync result (immediate asset)
    if (result.status === "ready" && result.assetBuffer) {
      try {
        const stored = await storageService.putFile({
          companyId: resolvedCompanyId,
          namespace: "visual-content",
          originalFilename: result.filename || `visual-${contentItemId}.png`,
          contentType: result.contentType || "image/png",
          body: result.assetBuffer,
        });

        await db.insert(visualContentAssets).values({
          visualContentItemId: contentItemId,
          type: "image",
          objectKey: stored.objectKey,
          contentType: stored.contentType,
          width: result.width || spec.width,
          height: result.height || spec.height,
          byteSize: stored.byteSize,
        });

        await updateItem(contentItemId, { status: "ready" });

        updateJobRecord(job.id, {
          status: "ready",
          assetObjectKey: stored.objectKey,
          assetByteSize: stored.byteSize,
        });
      } catch (err) {
        logger.error({ err }, "Failed to store synchronous visual asset");
        await updateItem(contentItemId, { status: "failed" });
      }
    }

    logger.info(
      {
        contentItemId: row.id,
        jobId: job.id,
        backend: backend.name,
        contentType: opts.contentType,
        platform: opts.platform,
      },
      "Visual content generation started (DB)",
    );

    return { contentItemId: row.id, jobId: job.id, status: itemStatus };
  }

  async function listQueue(opts: {
    status?: string;
    platform?: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<VisualContentItem[]> {
    const conditions = [eq(visualContentItems.companyId, resolvedCompanyId)];

    if (opts.status) {
      conditions.push(
        sql`(${visualContentItems.status} = ${opts.status} OR ${visualContentItems.reviewStatus} = ${opts.status})`,
      );
    }
    if (opts.platform) {
      conditions.push(eq(visualContentItems.platform, opts.platform));
    }
    if (opts.agentId) {
      conditions.push(eq(visualContentItems.agentId, opts.agentId));
    }

    const rows = await db
      .select()
      .from(visualContentItems)
      .where(and(...conditions))
      .orderBy(desc(visualContentItems.createdAt))
      .limit(opts.limit || 50)
      .offset(opts.offset || 0);

    // Fetch assets for all items
    const itemIds = rows.map((r) => r.id);
    const allAssets = itemIds.length > 0
      ? await db
          .select()
          .from(visualContentAssets)
          .where(sql`${visualContentAssets.visualContentItemId} IN (${sql.join(itemIds.map((id) => sql`${id}`), sql`,`)})`)
      : [];

    const assetsByItem = new Map<string, Array<typeof visualContentAssets.$inferSelect>>();
    for (const asset of allAssets) {
      const list = assetsByItem.get(asset.visualContentItemId) ?? [];
      list.push(asset);
      assetsByItem.set(asset.visualContentItemId, list);
    }

    return rows.map((row) => rowToVisualItem(row, assetsByItem.get(row.id) ?? []));
  }

  async function getItem(id: string): Promise<VisualContentItem | undefined> {
    const [row] = await db
      .select()
      .from(visualContentItems)
      .where(eq(visualContentItems.id, id))
      .limit(1);

    if (!row) return undefined;

    const assets = await db
      .select()
      .from(visualContentAssets)
      .where(eq(visualContentAssets.visualContentItemId, id));

    return rowToVisualItem(row, assets);
  }

  async function reviewItem(
    id: string,
    reviewStatus: string,
    reviewComment?: string,
  ): Promise<void> {
    if (reviewStatus !== "approved" && reviewStatus !== "flagged") {
      throw new Error(`Invalid review status: ${reviewStatus}`);
    }

    const now = new Date();
    const updates: Record<string, unknown> = {
      reviewStatus,
      reviewComment: reviewComment ?? null,
      updatedAt: now,
    };

    if (reviewStatus === "approved") {
      updates.status = "published";
      updates.publishedAt = now;
    }
    if (reviewStatus === "flagged") {
      updates.status = "failed";
    }

    const result = await db
      .update(visualContentItems)
      .set(updates)
      .where(eq(visualContentItems.id, id))
      .returning({ id: visualContentItems.id });

    if (result.length === 0) {
      throw new Error(`Visual content item not found: ${id}`);
    }

    logger.info({ id, reviewStatus }, "Visual content item reviewed");
  }

  async function stats(): Promise<VisualContentStats> {
    const rows = await db
      .select()
      .from(visualContentItems)
      .where(eq(visualContentItems.companyId, resolvedCompanyId));

    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const byReviewStatus: Record<string, number> = {};
    const byBackend: Record<string, number> = {};

    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      byPlatform[row.platform] = (byPlatform[row.platform] || 0) + 1;
      if (row.agentId) byAgent[row.agentId] = (byAgent[row.agentId] || 0) + 1;
      byReviewStatus[row.reviewStatus] = (byReviewStatus[row.reviewStatus] || 0) + 1;
      if (row.backend) byBackend[row.backend] = (byBackend[row.backend] || 0) + 1;
    }

    return { total: rows.length, byStatus, byPlatform, byAgent, byReviewStatus, byBackend };
  }

  const stopPolling = startJobPolling(15_000);

  return { generate, listQueue, getItem, reviewItem, stats, stopPolling };
}
