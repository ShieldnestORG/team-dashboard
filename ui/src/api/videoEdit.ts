import { api } from "./client";

export interface VideoEditJob {
  id: string;
  status: string;
  engine: string;
  inputDir: string;
  editBrief: string;
  options: Record<string, unknown> | null;
  outputPath: string | null;
  durationSec: number | null;
  fileSizeBytes: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  filesPurgedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoEditQueueCounts {
  pending: number;
  running: number;
  ready: number;
  failed: number;
  canceled: number;
}

export interface VideoEditConfig {
  engine: string;
  engineConfigured: boolean;
  pipelineEnabled: boolean;
  videoUseBin: string | null;
  dataDir: string;
  freeDiskBytes: number | null;
  queue: VideoEditQueueCounts;
  runningJobId: string | null;
  runningSince: string | null;
  lastCompletedAt: string | null;
  recentFailures: Array<{ id: string; error: string | null; at: string | null }>;
}

export interface VideoEditStats {
  jobs: VideoEditQueueCounts & { total: number };
}

export interface VideoEditOptionsInput {
  aspect?: "16:9" | "9:16" | "1:1";
  colorGrade?: string;
  burnCaptions?: boolean;
  targetDurationSec?: number;
  extra?: Record<string, unknown>;
}

export const videoEditApi = {
  getConfig: () => api.get<VideoEditConfig>("/video-edit/config"),
  getStats: () => api.get<VideoEditStats>("/video-edit/stats"),
  getJobs: () => api.get<{ jobs: VideoEditJob[] }>("/video-edit/jobs"),
  getJob: (id: string) => api.get<{ job: VideoEditJob }>(`/video-edit/jobs/${id}`),
  createJob: (input: {
    inputDir: string;
    editBrief: string;
    options?: VideoEditOptionsInput;
  }) => api.post<{ job: VideoEditJob }>("/video-edit/jobs", input),
  runJob: (id: string) =>
    api.post<{ processed: boolean; jobId?: string; reason?: string }>(
      `/video-edit/jobs/${id}/run`,
      {},
    ),
  cancelJob: (id: string) =>
    api.post<{ success: boolean }>(`/video-edit/jobs/${id}/cancel`, {}),
  videoDownloadUrl: (id: string) => `/api/video-edit/jobs/${encodeURIComponent(id)}/video`,
};
