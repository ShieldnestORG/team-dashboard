import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { logger } from "../middleware/logger.js";
import type { VisualJobStatus } from "./visual-backends/types.js";
import { getBackend } from "./visual-backends/index.js";

export interface VisualJob {
  id: string;
  backendName: string;
  backendJobId: string;
  contentItemId: string;
  type: "image" | "video";
  status: VisualJobStatus;
  prompt: string;
  error?: string;
  assetObjectKey?: string;
  assetContentType?: string;
  assetByteSize?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobCompletionCallback {
  (job: VisualJob, assetBuffer: Buffer): Promise<void>;
}

const JOBS_PATH = join(process.cwd(), "data", "visual-jobs.json");

function ensureDir() {
  const dir = dirname(JOBS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJobs(): VisualJob[] {
  if (!existsSync(JOBS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(JOBS_PATH, "utf-8")) as VisualJob[];
  } catch {
    return [];
  }
}

function writeJobs(jobs: VisualJob[]): void {
  ensureDir();
  writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

let jobsCache: VisualJob[] | null = null;

function getJobs(): VisualJob[] {
  if (!jobsCache) jobsCache = readJobs();
  return jobsCache;
}

function persist(): void {
  if (jobsCache) writeJobs(jobsCache);
}

export function createJob(opts: {
  backendName: string;
  backendJobId: string;
  contentItemId: string;
  type: "image" | "video";
  status: VisualJobStatus;
  prompt: string;
  width?: number;
  height?: number;
  durationMs?: number;
}): VisualJob {
  const now = new Date().toISOString();
  const job: VisualJob = {
    id: randomUUID(),
    backendName: opts.backendName,
    backendJobId: opts.backendJobId,
    contentItemId: opts.contentItemId,
    type: opts.type,
    status: opts.status,
    prompt: opts.prompt,
    width: opts.width,
    height: opts.height,
    durationMs: opts.durationMs,
    createdAt: now,
    updatedAt: now,
  };
  const jobs = getJobs();
  jobs.push(job);
  persist();
  logger.info({ jobId: job.id, backend: opts.backendName, type: opts.type }, "Visual job created");
  return job;
}

export function getJob(jobId: string): VisualJob | undefined {
  return getJobs().find((j) => j.id === jobId);
}

export function getJobByContentItem(contentItemId: string): VisualJob | undefined {
  return getJobs().find((j) => j.contentItemId === contentItemId);
}

export function updateJob(jobId: string, updates: Partial<VisualJob>): void {
  const jobs = getJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return;
  Object.assign(jobs[idx], updates, { updatedAt: new Date().toISOString() });
  persist();
}

export function getPendingJobs(): VisualJob[] {
  return getJobs().filter(
    (j) => j.status === "queued" || j.status === "generating" || j.status === "processing",
  );
}

let onJobComplete: JobCompletionCallback | null = null;

export function setJobCompletionCallback(cb: JobCompletionCallback): void {
  onJobComplete = cb;
}

export async function pollPendingJobs(): Promise<void> {
  const pending = getPendingJobs();
  if (pending.length === 0) return;

  logger.debug({ count: pending.length }, "Polling pending visual jobs");

  for (const job of pending) {
    const backend = getBackend(job.backendName);
    if (!backend) {
      updateJob(job.id, {
        status: "failed",
        error: `Backend ${job.backendName} no longer available`,
      });
      continue;
    }

    try {
      const result = await backend.checkJob(job.backendJobId);

      if (result.status === "ready" && result.assetBuffer) {
        updateJob(job.id, {
          status: "ready",
          width: result.width,
          height: result.height,
          durationMs: result.durationMs,
          assetContentType: result.contentType,
          assetByteSize: result.assetBuffer.length,
        });

        if (onJobComplete) {
          await onJobComplete(job, result.assetBuffer);
        }

        logger.info({ jobId: job.id }, "Visual job completed");
      } else if (result.status === "failed") {
        updateJob(job.id, { status: "failed", error: result.error });
        logger.warn({ jobId: job.id, error: result.error }, "Visual job failed");
      }
    } catch (err) {
      logger.error({ err, jobId: job.id }, "Error polling visual job");
    }
  }
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startJobPolling(intervalMs = 15_000): () => void {
  if (pollInterval) return () => {};

  pollInterval = setInterval(() => {
    void pollPendingJobs();
  }, intervalMs);

  logger.info({ intervalMs }, "Visual job polling started");

  return () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
      logger.info("Visual job polling stopped");
    }
  };
}
