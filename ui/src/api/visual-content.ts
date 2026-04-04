import { api } from "./client";

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

export interface VisualContentItem {
  id: string;
  agentId: string;
  contentType: string;
  platform: string;
  status: string;
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
  reviewStatus: string;
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

export interface VisualBackendInfo {
  name: string;
  capabilities: string[];
  enabled: boolean;
}

export interface VisualJobInfo {
  id: string;
  backendName: string;
  status: string;
  contentItemId: string;
  type: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualGenerateResult {
  contentItemId: string;
  jobId: string;
  status: string;
}

export const visualContentApi = {
  backends: () =>
    api.get<{ backends: VisualBackendInfo[] }>("/visual/backends"),

  generate: (params: {
    agentId: string;
    contentType: string;
    platform: string;
    topic: string;
    prompt: string;
    scriptText?: string;
    contextQuery?: string;
    backendName?: string;
  }) => api.post<VisualGenerateResult>("/visual/generate", params),

  jobStatus: (jobId: string) =>
    api.get<VisualJobInfo>(`/visual/jobs/${encodeURIComponent(jobId)}`),

  listQueue: (params: {
    status?: string;
    platform?: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params.status) searchParams.set("status", params.status);
    if (params.platform) searchParams.set("platform", params.platform);
    if (params.agentId) searchParams.set("agentId", params.agentId);
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.offset) searchParams.set("offset", String(params.offset));
    const qs = searchParams.toString();
    return api.get<{ items: VisualContentItem[]; count: number }>(
      `/visual/queue${qs ? `?${qs}` : ""}`,
    );
  },

  reviewItem: (id: string, reviewStatus: string, reviewComment?: string) =>
    api.patch<{ success: boolean }>(
      `/visual/queue/${encodeURIComponent(id)}/review`,
      { reviewStatus, ...(reviewComment ? { reviewComment } : {}) },
    ),

  stats: () => api.get<VisualContentStats>("/visual/queue/stats"),

  assetUrl: (objectKey: string) => `/api/visual/assets/${objectKey}`,
};
