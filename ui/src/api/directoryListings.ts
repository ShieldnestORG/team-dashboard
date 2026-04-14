import { api } from "./client.js";

export interface ListingTier {
  slug: "featured" | "verified" | "boosted";
  label: string;
  monthlyPriceCents: number;
  stripePriceConfigured: boolean;
}

export interface ListingTiersResponse {
  tiers: ListingTier[];
  stripeConfigured: boolean;
}

export interface ListingStats {
  totalCompanies: number;
  prospects: number;
  contacted: number;
  checkoutSent: number;
  active: number;
  pastDue: number;
  canceled: number;
  expired: number;
  withContactEmail: number;
  mrrCents: number;
}

export interface CompanyListingRow {
  id: number;
  slug: string;
  name: string;
  category: string;
  directory: string;
  website: string | null;
  githubOrg: string | null;
  twitterHandle: string | null;
  subreddit: string | null;
  contactEmail: string | null;
  contactName: string | null;
  contactNotes: string | null;
  listing: {
    id: number;
    tier: string;
    status: string;
    monthlyPriceCents: number;
    currentPeriodEnd: string | null;
    lastOutreachAt: string | null;
    startedAt: string | null;
    checkoutUrl: string | null;
  } | null;
}

export interface ListingsListResponse {
  items: CompanyListingRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListingEvent {
  id: number;
  listingId: number | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  payload: unknown;
  createdAt: string;
}

export interface TrafficAttribution {
  company: { id: number; slug: string; name: string };
  totals: {
    mentions: number;
    publishedMentions: number;
    clicks: number;
    engagementScore: number;
  };
  recentMentions: Array<{
    id: string;
    title: string;
    platform: string;
    status: string;
    clickCount: number;
    publishedAt: string | null;
  }>;
}

export const directoryListingsApi = {
  getTiers: () => api.get<ListingTiersResponse>("/directory-listings/tiers"),
  getStats: () => api.get<ListingStats>("/directory-listings/stats"),
  list: (params: {
    directory?: string;
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.directory && params.directory !== "all") query.set("directory", params.directory);
    if (params.search) query.set("search", params.search);
    if (params.status) query.set("status", params.status);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    return api.get<ListingsListResponse>(`/directory-listings${qs ? `?${qs}` : ""}`);
  },
  updateContact: (
    companyId: number,
    body: { email?: string; name?: string; notes?: string },
  ) => api.patch<{ ok: boolean }>(`/directory-listings/company/${companyId}/contact`, body),
  getTraffic: (companyId: number) =>
    api.get<TrafficAttribution>(`/directory-listings/company/${companyId}/traffic`),
  createCheckout: (body: { companyId: number; tier: string }) =>
    api.post<{ url: string; listingId: number }>("/directory-listings/checkout", body),
  cancelListing: (id: number) =>
    api.post<{ ok: boolean }>(`/directory-listings/${id}/cancel`, {}),
  addNote: (id: number, note: string) =>
    api.post<{ ok: boolean }>(`/directory-listings/${id}/note`, { note }),
  markOutreach: (id: number | null, companyId: number) =>
    api.post<{ ok: boolean; listingId: number }>(
      `/directory-listings/${id ?? 0}/outreach`,
      { companyId },
    ),
  getEvents: (id: number) =>
    api.get<{ events: ListingEvent[] }>(`/directory-listings/${id}/events`),
};
