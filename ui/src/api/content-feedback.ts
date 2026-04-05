import { api } from "./client";

export interface FeedbackItem {
  id: string;
  contentItemId: string;
  contentType: string;
  rating: string;
  comment: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface FeedbackStats {
  byPersonality: Array<{
    personalityId: string;
    platform: string;
    likes: number;
    dislikes: number;
    total: number;
  }>;
  totals: {
    likes: number;
    dislikes: number;
    total: number;
  };
}

export const contentFeedbackApi = {
  submit: (contentItemId: string, rating: "like" | "dislike", comment?: string, contentType: "text" | "visual" = "text") =>
    api.post<FeedbackItem>(`/content/${encodeURIComponent(contentItemId)}/feedback`, {
      rating,
      comment,
      contentType,
    }),
  getForItem: (contentItemId: string) =>
    api.get<{ feedback: FeedbackItem[] }>(`/content/${encodeURIComponent(contentItemId)}/feedback`),
  stats: () =>
    api.get<FeedbackStats>("/content/feedback/stats"),
};
