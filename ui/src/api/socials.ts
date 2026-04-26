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
