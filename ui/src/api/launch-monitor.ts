import { api } from "./client.js";

export interface LaunchTrackedItem {
  id: string;
  companyId: string;
  platform: "hn" | "reddit" | "devto" | string;
  externalId: string;
  title: string | null;
  postUrl: string | null;
  watchUntil: string;
  lastPolledAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface CommentReply {
  id: string;
  companyId: string;
  trackedItemId: string;
  platform: "hn" | "reddit" | "devto" | string;
  externalCommentId: string;
  externalCommentUrl: string;
  author: string | null;
  commentBody: string;
  patternId: string | null;
  confidence: string | null;
  suggestedReply: string | null;
  status: "pending" | "replied" | "dismissed" | "needs_custom" | string;
  dismissedReason: string | null;
  repliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const launchMonitorApi = {
  listComments: (status: string = "pending") =>
    api.get<{ comments: CommentReply[] }>(
      `/launch-monitor/comments?status=${encodeURIComponent(status)}`,
    ),
  markReplied: (id: string) =>
    api.post<{ comment: CommentReply }>(`/launch-monitor/comments/${id}/replied`, {}),
  dismiss: (id: string, reason?: string) =>
    api.post<{ comment: CommentReply }>(`/launch-monitor/comments/${id}/dismiss`, {
      reason: reason ?? null,
    }),

  listTrackedItems: () =>
    api.get<{ items: LaunchTrackedItem[] }>("/launch-monitor/tracked-items"),
  addTrackedItem: (input: {
    platform: "hn" | "reddit" | "devto";
    externalId: string;
    title?: string;
    postUrl?: string;
    watchHours?: number;
  }) =>
    api.post<{ item: LaunchTrackedItem; alreadyExisted?: boolean }>(
      "/launch-monitor/tracked-items",
      input,
    ),
  removeTrackedItem: (id: string) =>
    api.delete<{ ok: true }>(`/launch-monitor/tracked-items/${id}`),
};
