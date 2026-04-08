import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoReplyConfig {
  id: string;
  companyId: string;
  targetType: string; // 'account' | 'keyword'
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

export interface AutoReplyStats {
  todaySent: number;
  todayFailed: number;
  todayRateLimited: number;
  avgLatencyMs: number;
  globalBudget: {
    repliesUsed: number;
    repliesLimit: number;
  };
}

export interface PulseDiagnostics {
  stream: {
    connected: boolean;
    uptime: number;
    tweetsPerMinute: number;
    lastHeartbeat: string | null;
    lastError: string | null;
    fallbackToPolling: boolean;
    bearerTokenPresent: boolean;
    reconnectAttempts: number;
    totalTweetsIngested: number;
    startedAt: string | null;
  };
  polling: {
    clientActive: boolean;
    rateLimit: { remaining: number; resetAt: string } | null;
  };
  queries: Array<{ topic: string; query: string }>;
  tweetCounts: {
    lastHour: number;
    last24h: number;
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const autoReplyApi = {
  // Config CRUD
  listConfigs: () =>
    api.get<{ configs: AutoReplyConfig[] }>("/auto-reply/config"),

  createConfig: (data: {
    target: string; // "@username", "#hashtag", or "keyword"
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

  // Diagnostics
  getDiagnostics: () =>
    api.get<PulseDiagnostics>("/pulse/diagnostics"),
};
