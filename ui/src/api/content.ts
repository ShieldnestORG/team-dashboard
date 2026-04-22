import { api } from "./client";

export interface PublishTargetResult {
  success: boolean;
  error?: string;
  publishedAt?: string;
  url?: string;
}

export interface PublishResults {
  cd?: PublishTargetResult;
  sn?: PublishTargetResult;
  toknsApp?: PublishTargetResult;
}

export type PublishTargetSlug = "cd" | "sn" | "tokns-app";

export interface ContentQueueItem {
  id: string;
  platform: string;
  personality: string;
  contentType?: string;
  content: string;
  status: string;
  reviewStatus: string | null;
  reviewComment: string | null;
  createdAt: string;
  publishedAt: string | null;
  // blog-post specific
  slug?: string | null;
  publishResults?: PublishResults;
}

export interface ContentQueueStats {
  total: number;
  byStatus: Record<string, number>;
  byPlatform: Record<string, number>;
  byPersonality: Record<string, number>;
  byReviewStatus: Record<string, number>;
}

export interface ContentPreviewResult {
  content: string;
  metadata: {
    topic: string;
    contextQuery?: string;
    model: string;
    charCount: number;
    charLimit: number;
    withinLimit: boolean;
  };
}

export interface ContentGenerateResult {
  contentId: string;
  content: string;
  metadata: ContentPreviewResult["metadata"];
}

export interface ContentQueueListResponse {
  items: ContentQueueItem[];
  total: number;
}

export interface ContentClickEvent {
  id: string;
  contentItemId: string;
  companyId: string | null;
  eventType: string;
  referrer: string | null;
  userAgent: string | null;
  ipHash: string | null;
  clickOrigin: string;
  visitorType: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  clickedAt: string;
}

export interface ContentClicksResponse {
  rows: ContentClickEvent[];
  total: number;
}

export interface ContentClickMetrics {
  total: number;
  byType: { eventType: string; count: number }[];
  byDay: { date: string; count: number }[];
  byOrigin: { origin: string; count: number }[];
  byVisitorType: { visitorType: string; count: number }[];
}

export const contentClicksApi = {
  list: (params: { limit?: number; offset?: number; contentItemId?: string; companyId?: string }) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    if (params.contentItemId) qs.set("contentItemId", params.contentItemId);
    if (params.companyId) qs.set("companyId", params.companyId);
    return api.get<ContentClicksResponse>(`/content/clicks${qs.toString() ? `?${qs}` : ""}`);
  },
  metrics: (params?: { companyId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.companyId) qs.set("companyId", params.companyId);
    return api.get<ContentClickMetrics>(`/content/clicks/metrics${qs.toString() ? `?${qs}` : ""}`);
  },
};

export const contentApi = {
  listQueue: (params: {
    status?: string;
    platform?: string;
    personality?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params.status) searchParams.set("status", params.status);
    if (params.platform) searchParams.set("platform", params.platform);
    if (params.personality) searchParams.set("personality", params.personality);
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.offset) searchParams.set("offset", String(params.offset));
    const qs = searchParams.toString();
    return api.get<ContentQueueListResponse>(
      `/content/queue${qs ? `?${qs}` : ""}`,
    );
  },
  reviewItem: (id: string, reviewStatus: string, reviewComment?: string) =>
    api.patch<ContentQueueItem>(`/content/queue/${encodeURIComponent(id)}/review`, {
      reviewStatus,
      ...(reviewComment ? { reviewComment } : {}),
    }),
  republishTarget: (id: string, target: PublishTargetSlug) =>
    api.post<{
      success: boolean;
      error?: string;
      target: PublishTargetSlug;
      slug: string;
      publishResults: PublishResults;
    }>(`/content/queue/${encodeURIComponent(id)}/republish/${target}`, {}),
  stats: () => api.get<ContentQueueStats>("/content/queue/stats"),
  preview: (params: { personalityId: string; contentType: string; topic: string; contextQuery?: string }) =>
    api.post<ContentPreviewResult>("/content/preview", params),
  generate: (params: { personalityId: string; contentType: string; topic: string; contextQuery?: string }) =>
    api.post<ContentGenerateResult>("/content/generate", params),
};
