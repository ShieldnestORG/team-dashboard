import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoReplyConfig {
  id: string;
  companyId: string;
  targetType: string;
  targetXUserId: string | null;
  targetXUsername: string;
  enabled: boolean;
  replyMode: string;
  replyTemplates: string[] | null;
  aiPrompt: string | null;
  maxRepliesPerDay: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutoReplyLogEntry {
  id: string;
  companyId: string;
  configId: string;
  sourceTweetId: string;
  sourceAuthorUsername: string;
  replyTweetId: string | null;
  replyText: string;
  status: string;
  error: string | null;
  latencyMs: number | null;
  source: string;
  createdAt: string;
}

export interface AutoReplyGlobalSettings {
  pollIntervalMinutes: number;
  dailySpendCapUsd: number;
  globalMaxRepliesPerDay: number;
  defaultMinDelaySeconds: number;
  defaultMaxDelaySeconds: number;
  defaultMaxRepliesPerTarget: number;
  enabled: boolean;
}

export interface AutoReplyStats {
  todaySent: number;
  todayFailed: number;
  todayRateLimited: number;
  avgLatencyMs: number;
  budget: {
    spentUsd: number;
    capUsd: number;
    repliesSent: number;
    maxReplies: number;
    readCount: number;
  };
  settings: {
    pollIntervalMinutes: number;
    enabled: boolean;
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const autoReplyApi = {
  // Settings
  getSettings: () =>
    api.get<{ settings: AutoReplyGlobalSettings | null }>("/auto-reply/settings"),

  updateSettings: (data: Partial<AutoReplyGlobalSettings>) =>
    api.put<{ settings: AutoReplyGlobalSettings }>("/auto-reply/settings", data),

  // Config CRUD
  listConfigs: () =>
    api.get<{ configs: AutoReplyConfig[] }>("/auto-reply/config"),

  createConfig: (data: {
    target: string;
    targetXUserId?: string;
    targetXUsername?: string;
    targetType?: string;
    replyMode?: string;
    replyTemplates?: string[];
    aiPrompt?: string;
    maxRepliesPerDay?: number;
    minDelaySeconds?: number;
    maxDelaySeconds?: number;
  }) => api.post<{ config: AutoReplyConfig }>("/auto-reply/config", data),

  resolveUsername: (username: string) =>
    api.post<{ userId: string; username: string; name: string }>(
      "/auto-reply/resolve-username",
      { username },
    ),

  updateConfig: (id: string, data: Partial<AutoReplyConfig>) =>
    api.put<{ config: AutoReplyConfig }>(`/auto-reply/config/${id}`, data),

  deleteConfig: (id: string) =>
    api.delete<{ success: boolean }>(`/auto-reply/config/${id}`),

  toggleConfig: (id: string) =>
    api.post<{ config: AutoReplyConfig }>(`/auto-reply/config/${id}/toggle`, {}),

  // Log & stats
  getLog: (page = 1, limit = 20) =>
    api.get<{ log: AutoReplyLogEntry[]; page: number; limit: number }>(
      `/auto-reply/log?page=${page}&limit=${limit}`,
    ),

  getStats: () =>
    api.get<AutoReplyStats>("/auto-reply/stats"),
};
