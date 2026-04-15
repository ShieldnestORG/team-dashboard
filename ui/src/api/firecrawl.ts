import { api } from "./client";
import type { SystemCronJob } from "./system-crons";

export interface FirecrawlMetrics {
  totalScrapes: number;
  scrapesLast7d: number;
  scrapesLast24h: number;
  intelCompaniesCovered: number;
}

export interface FirecrawlRecentScrape {
  id: number;
  companySlug: string;
  headline: string;
  sourceUrl: string | null;
  capturedAt: string;
  bodySize: number;
}

export interface FirecrawlHostInfo {
  url: string;
  mode: "self-hosted" | "cloud";
}

export interface FirecrawlOverview {
  crons: SystemCronJob[];
  metrics: FirecrawlMetrics;
  recentScrapes: FirecrawlRecentScrape[];
  host: FirecrawlHostInfo;
}

export const firecrawlApi = {
  getOverview: () => api.get<FirecrawlOverview>("/firecrawl/admin/overview"),
  runJob: (jobName: string) =>
    api.post<{ ok: true }>(`/firecrawl/admin/run/${encodeURIComponent(jobName)}`, {}),
};
