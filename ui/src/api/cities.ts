import { api } from "./client";

export interface CityItem {
  term: string;
  rank: number;
  score: number;
  source: string;
  collectedAt?: string;
  meta?: Record<string, unknown>;
}

export interface CityRawSource {
  source: string;
  url: string;
  fetchedAt: string;
  itemCount: number;
}

export interface CityIntelligenceRow {
  id: string;
  companyId: string;
  slug: string;
  city: string;
  region: string | null;
  country: string;
  population: number | null;
  topSearches: CityItem[];
  serviceDemand: CityItem[];
  trendingTopics: CityItem[];
  rawSources: CityRawSource[];
  collectedAt: string;
  freshUntil: string | null;
  collectionDurationMs: number | null;
  collectionStatus: "pending" | "running" | "ready" | "error";
  collectionError: string | null;
}

export interface CityListEntry {
  id: string;
  slug: string;
  city: string;
  region: string | null;
  country: string;
  population: number | null;
  collectedAt: string;
  freshUntil: string | null;
  collectionStatus: "pending" | "running" | "ready" | "error";
  collectionError: string | null;
  collectionDurationMs: number | null;
  itemCounts: {
    topSearches: number;
    serviceDemand: number;
    trendingTopics: number;
  };
}

export interface CityListResponse {
  cities: CityListEntry[];
  stats: {
    total: number;
    ready: number;
    running: number;
    error: number;
    totalItems: number;
  };
}

export interface CityCollectRequest {
  city: string;
  region?: string | null;
  country?: string | null;
  force?: boolean;
}

export interface CityCollectResponse {
  slug: string;
  status: "ready" | "error";
  cached?: boolean;
  city?: CityIntelligenceRow;
  result?: {
    slug: string;
    status: "ready" | "error";
    topSearches: CityItem[];
    serviceDemand: CityItem[];
    trendingTopics: CityItem[];
    rawSources: CityRawSource[];
    durationMs: number;
    error?: string;
  };
}

export interface CityPitchResponse {
  city: string;
  variants: Array<{ length: "short" | "medium" | "long"; text: string }>;
}

export interface DirectoryMatch {
  slug: string;
  name: string;
  directory: string;
  website: string | null;
  category: string;
}

export interface CityBusinessLead {
  id: string;
  companyId: string;
  citySlug: string;
  topic: string;
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  category: string | null;
  rating: string | null;
  reviewCount: number | null;
  source: string;
  sourceUrl: string | null;
  rawSnippet: string | null;
  leadStatus: "new" | "verified" | "promoted_partner" | "skipped";
  partnerId: string | null;
  foundAt: string;
  actionedAt: string | null;
  notes: string | null;
}

export interface BusinessFinderRequest {
  city: string;
  region?: string | null;
  topic: string;
  limit?: number;
}

export interface BusinessFinderResponse {
  leads: CityBusinessLead[];
  count: number;
}

export interface LeadsListResponse {
  leads: CityBusinessLead[];
  count: number;
  topics: string[];
}

export interface PartnerPreFill {
  name: string;
  website: string;
  phone: string;
  address: string;
  industry: string;
  location: string;
  description: string;
  contactEmail: string;
}

export interface PromotePartnerResponse {
  preFill: PartnerPreFill;
  lead: CityBusinessLead;
}

export const citiesApi = {
  list: (params?: { status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.q) qs.set("q", params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api.get<CityListResponse>(`/cities${suffix}`);
  },
  get: (slug: string) =>
    api.get<{ city: CityIntelligenceRow }>(`/cities/${encodeURIComponent(slug)}`),
  collect: (body: CityCollectRequest) =>
    api.post<CityCollectResponse>("/cities/collect", body),
  refresh: (slug: string) =>
    api.post<CityCollectResponse>(`/cities/${encodeURIComponent(slug)}/refresh`, {}),
  pitch: (slug: string, body: { productOrService: string; audience?: string }) =>
    api.post<CityPitchResponse>(`/cities/${encodeURIComponent(slug)}/pitch`, body),
  directoryMatches: (slug: string) =>
    api.get<{ matches: DirectoryMatch[] }>(
      `/cities/${encodeURIComponent(slug)}/directory-matches`,
    ),

  findBusinesses: (body: BusinessFinderRequest) =>
    api.post<BusinessFinderResponse>("/cities/find-businesses", body),

  getLeads: (slug: string, params?: { topic?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.topic) q.set("topic", params.topic);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return api.get<LeadsListResponse>(`/cities/${slug}/leads${qs}`);
  },

  updateLead: (id: string, body: { leadStatus?: string; notes?: string }) =>
    api.patch<{ lead: CityBusinessLead }>(`/cities/leads/${id}`, body),

  promoteLead: (id: string) =>
    api.post<PromotePartnerResponse>(`/cities/leads/${id}/promote-partner`, {}),

  generateLeadContent: (
    id: string,
    body?: { personalityId?: string; contentType?: string },
  ) =>
    api.post<{ contentItem: unknown; topic: string }>(
      `/cities/leads/${id}/generate-content`,
      body ?? {},
    ),
};
