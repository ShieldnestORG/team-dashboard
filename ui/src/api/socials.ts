import { api } from "./client.js";

export interface SocialAccount {
  id: string;
  companyId: string;
  brand: string;
  platform: string;
  handle: string;
  displayName: string | null;
  profileUrl: string | null;
  connectionType: "oauth" | "api_key" | "manual" | "none";
  oauthRef: string | null;
  // Derived by GET /socials/accounts: which publisher this account posts through.
  // "zernio" when oauthRef starts with "zernio:", else "native". Absent on
  // create/update responses, hence optional.
  routing?: "zernio" | "native";
  status: "active" | "dormant" | "paused" | "deprecated";
  automationMode: "full_auto" | "assisted" | "manual" | "none";
  automationNotes: string | null;
  lastActivityAt: string | null;
  ownerUserId: string | null;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SocialAutomation {
  id: string;
  socialAccountId: string | null;
  kind: string;
  cronExpr: string | null;
  personalityId: string | null;
  contentType: string | null;
  sourceRef: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  notes: string | null;
}

export interface SocialPost {
  id: string;
  socialAccountId: string;
  text: string;
  mediaUrls: string[];
  altTexts: string[];
  replyToUrl: string | null;
  scheduledAt: string;
  status: "scheduled" | "publishing" | "posted" | "failed" | "canceled";
  attempts: number;
  maxAttempts: number;
  postedUrl: string | null;
  platformPostId: string | null;
  error: string | null;
  createdAt: string;
  postedAt: string | null;
  platform: string;
  brand: string;
  handle: string;
}

export interface NewSocialPost {
  socialAccountId: string;
  text: string;
  mediaUrls?: string[];
  altTexts?: string[];
  replyToUrl?: string;
  scheduledAt?: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
}

export interface RelayerTickResult {
  picked: number;
  posted: number;
  failed: number;
  retrying: number;
  skipped: number;
}

export interface PlatformCap {
  id: string;
  platform: string;
  maxGeneratedPerDay: number;
  maxPublishedPerDay: number;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCounter {
  platform: string;
  generatedToday: number;
  generatedCap: number;
  publishedToday: number;
  publishedCap: number;
  queued: number;
  failed24h: number;
  enabled: boolean;
}

export interface CalendarEvent {
  id: string;
  source: "content" | "cron-projection";
  when: string;
  brand: string;
  platform: string;
  status: string;
  title: string;
  contentItemId?: string;
  socialAccountId?: string | null;
  automated: boolean;
}

export const socialsApi = {
  listAccounts: (params?: { brand?: string; platform?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.brand) q.set("brand", params.brand);
    if (params?.platform) q.set("platform", params.platform);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return api.get<{ accounts: SocialAccount[] }>(`/socials/accounts${qs ? `?${qs}` : ""}`);
  },
  createAccount: (data: Partial<SocialAccount>) =>
    api.post<{ account: SocialAccount }>("/socials/accounts", data),
  updateAccount: (id: string, data: Partial<SocialAccount>) =>
    api.patch<{ account: SocialAccount }>(`/socials/accounts/${id}`, data),
  archiveAccount: (id: string) => api.delete<{ ok: true }>(`/socials/accounts/${id}`),
  listAutomations: (accountId?: string) =>
    api.get<{ automations: SocialAutomation[] }>(
      `/socials/automations${accountId ? `?accountId=${accountId}` : ""}`,
    ),
  syncAutomations: () => api.post<{ upserted: number; skipped: number }>("/socials/automations/sync", {}),
  listPosts: (params?: { accountId?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.accountId) q.set("accountId", params.accountId);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return api.get<{ posts: SocialPost[] }>(`/socials/posts${qs ? `?${qs}` : ""}`);
  },
  createPost: (data: NewSocialPost) =>
    api.post<{ post: SocialPost }>("/socials/posts", data),
  cancelPost: (id: string) => api.delete<{ ok: true }>(`/socials/posts/${id}`),
  relayNow: () => api.post<RelayerTickResult>("/socials/posts/relay-now", {}),
  listPlatformCaps: () =>
    api.get<{ caps: PlatformCap[] }>("/socials/platform-caps"),
  updatePlatformCap: (
    platform: string,
    data: Partial<Pick<PlatformCap, "maxGeneratedPerDay" | "maxPublishedPerDay" | "enabled" | "notes">>,
  ) => api.patch<{ cap: PlatformCap }>(`/socials/platform-caps/${platform}`, data),
  listPlatformCounters: () =>
    api.get<{ counters: PlatformCounter[] }>("/socials/platform-counters"),
  calendar: (params: { from?: string; to?: string; brand?: string; platform?: string }) => {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.brand) q.set("brand", params.brand);
    if (params.platform) q.set("platform", params.platform);
    return api.get<{ from: string; to: string; events: CalendarEvent[] }>(
      `/socials/calendar?${q.toString()}`,
    );
  },
};
