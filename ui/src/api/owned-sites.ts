import { api } from "./client";

export type OwnedSiteStatus =
  | "building"
  | "live"
  | "adsense_pending"
  | "monetized"
  | "killed";

export interface OwnedSiteRollup {
  siteId: string;
  sessions30d: number;
  pageviews30d: number;
  adRevenueCents30d: number;
  adImpressions30d: number;
  rpmCentsAvg30d: number;
  outboundToCoherence30d: number;
  outboundToTokns30d: number;
}

export interface OwnedSite {
  id: string;
  companyId: string;
  slug: string;
  domain: string;
  displayName: string;
  primaryTool: string | null;
  niche: string | null;
  status: OwnedSiteStatus;
  launchedAt: string | null;
  adsenseAccountId: string | null;
  gaPropertyId: string | null;
  gscSiteUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  rollup: OwnedSiteRollup;
}

export interface OwnedSiteMetricRow {
  id: string;
  siteId: string;
  date: string;
  sessions: number;
  pageviews: number;
  adImpressions: number;
  adRevenueCents: number;
  rpmCents: number;
  outboundClicksToCoherence: number;
  outboundClicksToTokns: number;
  source: string;
  capturedAt: string;
}

export interface OwnedSiteDetail {
  site: Omit<OwnedSite, "rollup">;
  series: OwnedSiteMetricRow[];
}

export interface CreateOwnedSiteBody {
  slug: string;
  domain: string;
  displayName: string;
  primaryTool?: string;
  niche?: string;
  status?: OwnedSiteStatus;
  adsenseAccountId?: string;
  gaPropertyId?: string;
  gscSiteUrl?: string;
  notes?: string;
}

export const ownedSitesApi = {
  list: () => api.get<{ sites: OwnedSite[] }>("/owned-sites"),
  detail: (slug: string, rangeDays = 90) =>
    api.get<OwnedSiteDetail>(`/owned-sites/${slug}?range=${rangeDays}`),
  create: (body: CreateOwnedSiteBody) =>
    api.post<{ site: OwnedSite }>("/owned-sites", body),
  update: (slug: string, body: Partial<CreateOwnedSiteBody>) =>
    api.patch<{ site: OwnedSite }>(`/owned-sites/${slug}`, body),
  sync: (slug: string) =>
    api.post<{
      siteId: string;
      ga4: { ok: boolean; rowsUpserted: number; reason?: string };
      adsense: { ok: boolean; rowsUpserted: number; reason?: string };
    }>(`/owned-sites/${slug}/sync`, {}),
  triggerCron: () =>
    api.post<{ ok: boolean; error?: string }>("/owned-sites/cron/run", {}),
};
