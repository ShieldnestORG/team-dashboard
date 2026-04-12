import { api } from "./client";

export const youtubeApi = {
  getPipeline: () => api.get("/youtube/pipeline"),
  runPipeline: (opts?: { topic?: string; visualMode?: string }) =>
    api.post("/youtube/pipeline/run", opts || {}),
  getQueue: () => api.get("/youtube/queue"),
  publishNow: (id: string) => api.post(`/youtube/queue/${id}/publish-now`, {}),
  rescheduleQueueItem: (id: string, publishTime: string) =>
    api.patch(`/youtube/queue/${id}/schedule`, { publishTime }),
  deleteQueueItem: (id: string) => api.delete(`/youtube/queue/${id}`),
  getAnalytics: () => api.get("/youtube/analytics"),
  collectAnalytics: () => api.post("/youtube/analytics/collect", {}),
  getInsights: () => api.get<{ insights: string[] }>("/youtube/analytics/insights"),
  getStrategies: () => api.get("/youtube/strategies"),
  generateStrategy: (topic?: string) =>
    api.post("/youtube/strategies/generate", { topic }),
  getConfig: () =>
    api.get<{
      enabled: boolean;
      visualMode: string;
      ttsProviders: Array<{ name: string; configured: boolean }>;
      visualBackends: Array<{ name: string; capabilities: string[]; enabled: boolean }>;
      youtubeConfigured: boolean;
    }>("/youtube/config"),
  getStats: () =>
    api.get<{
      productions: Record<string, number>;
      queue: Record<string, number>;
    }>("/youtube/stats"),
  getVideos: () =>
    api.get<{
      videos: Array<{
        filename: string;
        productionId: string;
        title: string;
        status: string;
        visualMode: string;
        fileSizeBytes: number;
        createdAt: string;
        youtubeUrl: string | null;
        publishStatus: string | null;
      }>;
      totalSize: number;
      count: number;
    }>("/youtube/videos"),
  getVideoDownloadUrl: (filename: string) =>
    `/api/youtube/videos/${encodeURIComponent(filename)}/download`,
};
