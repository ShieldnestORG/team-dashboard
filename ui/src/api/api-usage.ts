import { api } from "./client";

// Success-path API usage/cost meter (api_usage_events). Board-only backend
// route; non-Anthropic models are token-metered but $0-priced until owner-
// verified prices land, so provider dollars can read low — calls/tokens are
// the faithful signal there.

export interface ApiUsageWindowTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface ApiUsageProviderRow {
  provider: string;
  today: ApiUsageWindowTotals;
  week: ApiUsageWindowTotals;
  month: ApiUsageWindowTotals;
}

export interface ApiUsageServiceRow {
  service: string;
  today: ApiUsageWindowTotals;
  week: ApiUsageWindowTotals;
  month: ApiUsageWindowTotals;
}

export interface ApiUsageSummary {
  todayUsd: number;
  weekUsd: number;
  monthUsd: number;
  byProvider: ApiUsageProviderRow[];
  byService: ApiUsageServiceRow[];
}

export const apiUsageApi = {
  summary: () => api.get<ApiUsageSummary>("/api-usage/summary"),
};
