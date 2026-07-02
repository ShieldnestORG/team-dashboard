import { api } from "./client.js";

// ---------------------------------------------------------------------------
// University email-campaign stats — typed client for
// GET /api/admin/university/email-stats (board-only). Mirrors
// server/src/routes/university-email-events.ts / UniversityEmailKindStats in
// server/src/services/university-email-events.ts.
// ---------------------------------------------------------------------------

export interface UniversityEmailKindStats {
  kind: string;
  // COUNT of university_email_log rows — only a few kinds log sends, so 0 here
  // does NOT mean nothing went out (see the page footnote).
  sent: number;
  // DISTINCT recipient emails per event (one member opening 5x = 1 open).
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  // opened / delivered and clicked / delivered — 0–1 fractions, 4-decimal.
  openRate: number;
  clickRate: number;
  // Raw click-event counts (NOT distinct emails), max 10, clicks DESC.
  topClickedUrls: Array<{ url: string; clicks: number }>;
}

export interface UniversityEmailStatsResponse {
  since: string | null;
  kinds: UniversityEmailKindStats[];
}

export const universityEmailStatsApi = {
  stats: (params?: { since?: string }) => {
    const qs = new URLSearchParams();
    if (params?.since) qs.set("since", params.since);
    return api.get<UniversityEmailStatsResponse>(
      `/admin/university/email-stats${qs.toString() ? `?${qs}` : ""}`,
    );
  },
};
