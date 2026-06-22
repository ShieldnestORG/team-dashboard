import { api } from "./client.js";

// ── Types mirror the ZERNIO ANALYTICS API contract ────────────────────────────

export type AnalyticsWindow = "7d" | "30d" | "90d";

export interface AccountSummary {
  socialAccountId: string;
  zernioAccountId: string;
  platform: string;
  username: string;
  displayName: string;
  impressions: number;
  reach: number;
  engagementRate: number;
  followers: number;
  followerGrowth: number;
  postCount: number;
}

export interface OverviewTotals {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  avgEngagementRate: number;
  followers: number;
}

export interface AnalyticsOverview {
  window: string;
  lastSync: string | null;
  dataDelaysNote: string;
  totals: OverviewTotals;
  accounts: AccountSummary[];
  connectedCount: number;
  // Accounts present in social_accounts but NOT Zernio-connected, so excluded
  // from the totals above (honesty note in the UI).
  unconnectedAccounts: string[];
}

export interface AccountInsights {
  reach: number;
  views: number;
  accountsEngaged: number;
  totalInteractions: number;
}

export interface FollowerPoint {
  date: string;
  value: number;
}

export interface PostMetric {
  zernioPostId: string | null;
  platformPostId: string | null;
  platformPostUrl: string | null;
  contentPreview: string | null;
  publishedAt: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  engagementRate: number;
}

export interface BestTime {
  day: string;
  hour: number;
  score: number;
}

export interface PostingFrequency {
  period: string;
  count: number;
}

export interface AccountDetail {
  account: AccountSummary;
  accountInsights: AccountInsights;
  followerHistory: FollowerPoint[];
  recentPosts: PostMetric[];
  bestTimes: BestTime[];
  postingFrequency: PostingFrequency[];
}

export interface Rec {
  scope: "account" | "post";
  subjectId: string;
  subjectLabel: string;
  action: "post_more" | "change" | "remove" | "keep";
  reason: string;
  signals: Record<string, number | string>;
}

export const socialsAnalyticsApi = {
  overview: (window: AnalyticsWindow = "30d") =>
    api.get<AnalyticsOverview>(`/socials/analytics/overview?window=${window}`),
  account: (socialAccountId: string, window: AnalyticsWindow = "30d") =>
    api.get<AccountDetail>(
      `/socials/analytics/accounts/${socialAccountId}?window=${window}`,
    ),
  recommendations: (accountId: "all" | string = "all") =>
    api.get<{ recommendations: Rec[] }>(
      `/socials/analytics/recommendations?accountId=${accountId}`,
    ),
};
