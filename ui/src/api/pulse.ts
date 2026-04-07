import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PulseTweetData {
  tweetId: string;
  authorUsername: string;
  authorName: string | null;
  text: string;
  createdAt: string;
  topic: string;
  sentimentScore: number | null;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    impressions: number;
  };
}

export interface PulseTopicSummary {
  name: string;
  tweetCount24h: number;
  avgSentiment?: number;
  trend?: "up" | "down" | "flat";
}

export interface PulseSummary {
  topics: PulseTopicSummary[];
  totalTweets24h: number;
  overallSentiment: number;
  xrplBridgeMentions24h: number;
  topTweet: PulseTweetData | null;
  updatedAt: string;
}

export interface XrplBridgeStats {
  totalMentions24h: number;
  totalMentions7d: number;
  stakingMentionPct: number;
  bridgeTypeBreakdown: Record<string, number>;
  trendingTweets: PulseTweetData[];
  promoMessage: string;
}

export interface PulseDataPoint {
  time: string;
  tweetCount: number;
  avgSentiment: number | null;
}

export interface PulseTopicBreakdown {
  topic: string;
  tweetCount: number;
  avgSentiment: number | null;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const pulseApi = {
  getSummary: (hours = 24) =>
    api.get<PulseSummary>(`/pulse/summary?hours=${hours}`),

  getTweets: (opts?: { topic?: string; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.topic) params.set("topic", opts.topic);
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.limit) params.set("limit", String(opts.limit));
    const q = params.toString();
    return api.get<{ tweets: PulseTweetData[]; page: number; limit: number }>(
      `/pulse/tweets${q ? `?${q}` : ""}`,
    );
  },

  getTrendingTweets: (topic?: string, limit = 10) => {
    const params = new URLSearchParams();
    if (topic) params.set("topic", topic);
    params.set("limit", String(limit));
    return api.get<{ tweets: PulseTweetData[] }>(
      `/pulse/tweets/trending?${params}`,
    );
  },

  getAggregations: (opts?: { topic?: string; period?: string; hours?: number }) => {
    const params = new URLSearchParams();
    if (opts?.topic) params.set("topic", opts.topic);
    if (opts?.period) params.set("period", opts.period);
    if (opts?.hours) params.set("hours", String(opts.hours));
    return api.get<{ dataPoints: PulseDataPoint[] }>(
      `/pulse/aggregations?${params}`,
    );
  },

  getXrplBridge: () =>
    api.get<XrplBridgeStats>("/pulse/xrpl-bridge"),

  getTopics: () =>
    api.get<{ topics: PulseTopicBreakdown[] }>("/pulse/topics"),

  getSpikes: () =>
    api.get<{ spikes: Array<{ topic: string; current: number; avg: number }> }>(
      "/pulse/spikes",
    ),

  forcePoll: () =>
    api.post<{ success: boolean; newTweets: number; queries: number }>(
      "/pulse/force-poll",
      {},
    ),
};
