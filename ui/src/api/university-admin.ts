import { api } from "./client.js";

// ---------------------------------------------------------------------------
// University admin — typed client for the /api/university-admin surface
// (board-only). Mirrors the route handlers in
// server/src/routes/university-admin.ts.
// ---------------------------------------------------------------------------

export interface UniversityAdminSubscriptionSummary {
  status: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
}

export interface UniversityAdminMemberRow {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  plan: string;
  joinedAt: string | null;
  subscription: UniversityAdminSubscriptionSummary | null;
}

export interface UniversityAdminSubscriptionDetail {
  id: string;
  status: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface UniversityAdminPostRow {
  id: string;
  body: string;
  status: string;
  commentCount: number;
  reactionCount: number;
  createdAt: string;
}

export interface UniversityAdminTimelineEntry {
  at: string | null;
  kind: string;
  label: string;
}

export interface UniversityAdminMemberDetail {
  member: {
    id: string;
    accountId: string | null;
    email: string;
    displayName: string | null;
    status: string;
    plan: string;
    joinedAt: string | null;
    createdAt: string;
  };
  subscription: UniversityAdminSubscriptionDetail | null;
  posts: UniversityAdminPostRow[];
  timeline: UniversityAdminTimelineEntry[];
}

export interface UniversityAdminActionResult {
  ok: boolean;
  member: UniversityAdminMemberRow | null;
  message?: string;
  accessUntil?: string | null;
}

export const universityAdminApi = {
  listMembers: (params?: { status?: string | null; q?: string | null }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set("status", params.status);
    if (params?.q) search.set("q", params.q);
    const qs = search.toString();
    return api.get<{ members: UniversityAdminMemberRow[]; truncated: boolean }>(
      `/university-admin/members${qs ? `?${qs}` : ""}`,
    );
  },
  getMember: (id: string) =>
    api.get<UniversityAdminMemberDetail>(`/university-admin/members/${id}`),
  cancel: (id: string, reason?: string) =>
    api.post<UniversityAdminActionResult>(
      `/university-admin/members/${id}/cancel`,
      reason ? { reason } : {},
    ),
  reactivate: (id: string) =>
    api.post<UniversityAdminActionResult>(
      `/university-admin/members/${id}/reactivate`,
      {},
    ),
  recovery: () =>
    api.get<{ members: UniversityAdminMemberRow[] }>(
      "/university-admin/recovery",
    ),
};
