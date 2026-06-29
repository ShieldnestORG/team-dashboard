import { api } from "./client";

export interface ToolViewMetric {
  slug: string;
  views: number;
}

export interface ReferrerMetric {
  source: string;
  count: number;
}

export interface ProductRevenueRow {
  source: "printify" | "woo" | "reservation";
  product_id: string;
  product_title: string;
  units: number;
  gross_cents: number;
  net_cents: number;
  period_start: string;
  period_end: string;
}

export interface EmailFeedbackSrc {
  src: string;
  up: number;
  down: number;
  comments: number;
  total: number;
}

export interface EmailFeedback {
  total: number;
  up: number;
  down: number;
  comments: number;
  bySrc: EmailFeedbackSrc[];
}

export interface SiteMetricsPayload {
  pageViews?: number;
  uniqueVisitors?: number;
  toolViews?: ToolViewMetric[];
  subscribers?: number;
  directoryClicks?: number;
  topReferrers?: ReferrerMetric[];
  productRevenue?: ProductRevenueRow[];
  emailFeedback?: EmailFeedback;
  period: "hourly" | "daily" | "weekly";
  timestamp: string;
}

export interface SiteMetricEntry {
  siteId: string;
  metrics: SiteMetricsPayload;
  receivedAt: string;
}

export interface SiteMetricsListResponse {
  metrics: SiteMetricEntry[];
  total: number;
}

export const siteMetricsApi = {
  list: (
    companyId: string,
    filters?: { siteId?: string; period?: string; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (filters?.siteId) params.set("siteId", filters.siteId);
    if (filters?.period) params.set("period", filters.period);
    if (filters?.limit != null) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return api.get<SiteMetricsListResponse>(
      `/companies/${companyId}/site-metrics${qs ? `?${qs}` : ""}`,
    );
  },
};
