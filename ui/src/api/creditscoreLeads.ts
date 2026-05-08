import { api } from "./client";

// ---------------------------------------------------------------------------
// CreditScore Leads — admin lead view over stored reports + subscriptions.
// Server: GET /api/creditscore/reports (board auth)
// ---------------------------------------------------------------------------

export type CreditScoreReportStatus = "pending" | "complete" | "failed";
export type CreditScoreSubscriptionTier = "report" | "starter" | "growth" | "pro";

export interface CreditScoreReportLead {
  id: string;
  domain: string;
  email: string | null;
  score: number | null;
  previousScore: number | null;
  status: CreditScoreReportStatus | string;
  shareableSlug: string | null;
  createdAt: string;
  subscriptionId: string | null;
  subscriptionTier: CreditScoreSubscriptionTier | string | null;
  subscriptionStatus: string | null;
}

export interface ListReportsFilters {
  q?: string;
  status?: CreditScoreReportStatus | "";
  hasEmail?: boolean;
  hasSubscription?: boolean;
  tier?: CreditScoreSubscriptionTier | "";
  since?: string;
  limit?: number;
  offset?: number;
}

export interface ListReportsResponse {
  reports: CreditScoreReportLead[];
  total: number;
  limit: number;
  offset: number;
}

function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === null) continue;
    if (typeof v === "boolean") {
      if (v) sp.set(k, "true");
      continue;
    }
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export interface CompGrantInput {
  tier: CreditScoreSubscriptionTier;
  url: string;
  email: string;
  compReason: string;
  durationDays?: number;
}

export interface CreatePromoCodeInput {
  code: string;
  percentOff?: number;
  amountOffCents?: number;
  maxRedemptions?: number;
  expiresAt?: string;
  duration?: "once" | "repeating" | "forever";
  durationInMonths?: number;
  name?: string;
}

export interface PromoCode {
  id: string;
  code: string;
  active: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: number | null;
  coupon: {
    id: string;
    percentOff: number | null;
    amountOff: number | null;
    currency: string | null;
    duration: string;
  };
}

export const creditscoreLeadsApi = {
  listReports: (filters: ListReportsFilters = {}) =>
    api.get<ListReportsResponse>(
      `/creditscore/reports${buildQuery({
        q: filters.q,
        status: filters.status,
        hasEmail: filters.hasEmail,
        hasSubscription: filters.hasSubscription,
        tier: filters.tier,
        since: filters.since,
        limit: filters.limit,
        offset: filters.offset,
      })}`,
    ),
  compGrant: (input: CompGrantInput) =>
    api.post<{ subscriptionId: string }>("/creditscore/comp-grant", input),
  listPromoCodes: () =>
    api.get<{ codes: PromoCode[] }>("/creditscore/promo-codes"),
  createPromoCode: (input: CreatePromoCodeInput) =>
    api.post<{ couponId: string; promoCodeId: string; code: string }>(
      "/creditscore/promo-codes",
      input,
    ),
};
