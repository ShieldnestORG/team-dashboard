import { api } from "./client";

export interface Campaign {
  id: string;
  companyId: string;
  brand: string;
  name: string;
  status: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  targetSites: string[];
  personalityAllowlist: string[];
  createdAt: string;
  updatedAt: string;
  contentCount?: number;
}

export interface CampaignContentItem {
  id: string;
  topic: string;
  platform: string;
  personalityId: string;
  contentType: string;
  status: string;
  reviewStatus: string;
  engagementScore: string;
  clickCount: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface CreateCampaignInput {
  name: string;
  brand: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  targetSites?: string[];
  personalityAllowlist?: string[];
}

export interface PatchCampaignInput {
  name?: string;
  brand?: string;
  goal?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  targetSites?: string[];
  personalityAllowlist?: string[];
}

export const campaignsApi = {
  list: (params?: { brand?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.brand) qs.set("brand", params.brand);
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString();
    return api.get<{ campaigns: Campaign[] }>(`/campaigns${q ? `?${q}` : ""}`);
  },

  get: (id: string) => api.get<{ campaign: Campaign }>(`/campaigns/${id}`),

  create: (body: CreateCampaignInput) =>
    api.post<{ campaign: Campaign }>("/campaigns", body),

  patch: (id: string, body: PatchCampaignInput) =>
    api.patch<{ campaign: Campaign }>(`/campaigns/${id}`, body),

  delete: (id: string) => api.delete<void>(`/campaigns/${id}`),

  getContent: (id: string) =>
    api.get<{ items: CampaignContentItem[] }>(`/campaigns/${id}/content`),
};
