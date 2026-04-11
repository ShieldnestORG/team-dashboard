import { api } from "./client.js";

export interface Partner {
  id: string;
  companyId: string;
  slug: string;
  name: string;
  industry: string;
  location: string | null;
  website: string | null;
  description: string | null;
  services: string[] | null;
  socialHandles: Record<string, string> | null;
  contactName: string | null;
  contactEmail: string | null;
  tier: string;
  status: string;
  monthlyFee: number | null;
  referralFeePerClient: number | null;
  contentMentions: number;
  totalClicks: number;
  dashboardToken: string | null;
  partnerSince: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerMetrics {
  totalClicks: number;
  clicksByDay: { date: string; count: number }[];
  clicksBySource: { source: string | null; count: number }[];
  contentMentions: number;
}

export interface PartnerDashboardData extends PartnerMetrics {
  name: string;
  industry: string;
  website: string | null;
}

export interface CreatePartnerInput {
  name: string;
  slug?: string;
  industry: string;
  location?: string;
  website?: string;
  description?: string;
  services?: string[];
  socialHandles?: Record<string, string>;
  contactName?: string;
  contactEmail?: string;
  tier?: string;
  referralFeePerClient?: number;
  monthlyFee?: number;
}

export const partnersApi = {
  list: (opts?: { status?: string; industry?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.industry) params.set("industry", opts.industry);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ partners: Partner[]; total: number }>(`/partners${qs ? `?${qs}` : ""}`);
  },
  get: (slug: string) => api.get<{ partner: Partner }>(`/partners/${slug}`),
  create: (input: CreatePartnerInput) => api.post<{ partner: Partner }>("/partners", input),
  update: (slug: string, updates: Partial<Partner>) => api.put<{ partner: Partner }>(`/partners/${slug}`, updates),
  delete: (slug: string) => api.delete<{ ok: boolean }>(`/partners/${slug}`),
  getMetrics: (slug: string) => api.get<PartnerMetrics>(`/partners/${slug}/metrics`),
  getDashboard: (slug: string, token: string) => api.get<PartnerDashboardData>(`/partners/${slug}/dashboard?token=${token}`),
};
