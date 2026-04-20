const AFFILIATE_TOKEN_KEY = "affiliate_token";

export const getAffiliateToken = (): string | null => localStorage.getItem(AFFILIATE_TOKEN_KEY);
export const setAffiliateToken = (token: string): void => localStorage.setItem(AFFILIATE_TOKEN_KEY, token);
export const clearAffiliateToken = (): void => localStorage.removeItem(AFFILIATE_TOKEN_KEY);

export interface Affiliate {
  id: string;
  email: string;
  name: string;
  status: string; // "pending" | "active" | "suspended"
  commissionRate: string;
  policyAcceptedAt: string | null;
  createdAt: string;
}

// Phase 3 flat payload field names (sent to server).
export type FirstTouchStatus = "yes" | "no";
export type FirstTouchType = "in_person" | "call" | "text" | "email" | "social_dm";
export type RelationshipWarmth = "strong" | "medium" | "weak";
export type ClosePreference = "cd_closes" | "affiliate_assists" | "affiliate_attempts_first";

export interface SubmitProspectOptions {
  firstTouchStatus?: FirstTouchStatus;
  firstTouchType?: FirstTouchType;
  firstTouchDate?: string; // ISO
  firstTouchNotes?: string;
  relationshipWarmth?: RelationshipWarmth;
  closePreference?: ClosePreference;
}

export class AffiliateApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AffiliateApiError";
    this.status = status;
    this.code = code;
  }
}

export interface CompetitorSite {
  name: string;
  url: string;
  summary: string;
}

export type CommissionType = "initial" | "recurring";
export type CommissionStatus =
  | "pending_activation"
  | "approved"
  | "scheduled_for_payout"
  | "paid"
  | "held"
  | "reversed"
  | "clawed_back";

export interface Commission {
  id: string;
  type: CommissionType | string;
  rate: string;
  amountCents: number;
  basisCents: number;
  periodStart: string;
  periodEnd: string;
  status: CommissionStatus | string;
  stripeInvoiceId: string | null;
  holdExpiresAt: string | null;
  leadName: string | null;
  leadSlug: string | null;
  createdAt: string;
  clawbackReason?: string | null;
}

export type PayoutMethod = "stripe_connect" | "manual_ach" | "manual_paypal" | "manual_check";
export type PayoutStatus = "scheduled" | "sent" | "paid" | "failed";

export interface Payout {
  id: string;
  amountCents: number;
  commissionCount: number;
  method: PayoutMethod | string;
  externalId: string | null;
  status: PayoutStatus | string;
  batchMonth: string; // 'YYYY-MM'
  scheduledFor: string;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AffiliateMeResponse {
  affiliate: Affiliate;
  prospectCount: number;
  convertedCount: number;
  pendingCents: number;
  approvedCents: number;
  scheduledCents: number;
  paidCents: number;
  lifetimeCents: number;
}

export interface ListEarningsResponse {
  commissions: Commission[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListPayoutsResponse {
  payouts: Payout[];
  total: number;
}

export interface AffiliateProspect {
  id: string;
  slug: string;
  name: string;
  industry: string;
  location: string | null;
  website: string | null;
  description: string | null;
  services: string[] | null;
  onboardingStatus: string;
  isPaying: boolean;
  baselineAnalytics: {
    competitorSites?: CompetitorSite[];
    topKeywords?: string[];
    businessSummary?: string;
  } | null;
  affiliateNotes: string | null;
  storeNotes: string | null;
  createdAt: string;
}

// Phase 3 — affiliate-facing lead detail + timeline.
export interface AffiliateLead {
  id: string;
  name: string;
  slug: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  pipelineStage: string;
  lastActivityAt: string | null;
  createdAt: string;
}

export type TimelineActorType = "affiliate" | "admin" | "cd" | "system";

export interface TimelineActivity {
  id: string;
  actorType: TimelineActorType | string;
  activityType: string;
  note: string | null;
  timestamp: string;
}

export interface LeadTimelineResponse {
  lead: AffiliateLead;
  activities: TimelineActivity[];
}

async function affiliateRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAffiliateToken();
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`/api/affiliates${path}`, { ...init, headers });
  if (res.status === 401) {
    clearAffiliateToken();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new AffiliateApiError(
      body?.error ?? `Request failed: ${res.status}`,
      res.status,
      body?.code,
    );
  }
  return res.json() as Promise<T>;
}

export const affiliatesApi = {
  register: (body: { name: string; email: string; password: string }) =>
    affiliateRequest<{ affiliate: Affiliate }>("/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    affiliateRequest<{ token: string; affiliate: Affiliate }>("/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  me: () =>
    affiliateRequest<AffiliateMeResponse>("/me"),

  listEarnings: (opts?: { limit?: number; offset?: number; status?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    if (opts?.status) params.set("status", opts.status);
    const qs = params.toString();
    return affiliateRequest<ListEarningsResponse>(`/earnings${qs ? `?${qs}` : ""}`);
  },

  listPayouts: () =>
    affiliateRequest<ListPayoutsResponse>("/payouts"),

  acceptPolicy: () =>
    affiliateRequest<{ acceptedAt: string }>("/accept-policy", { method: "POST" }),

  listProspects: (opts?: { status?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return affiliateRequest<{ prospects: AffiliateProspect[]; total: number }>(
      `/prospects${qs ? `?${qs}` : ""}`,
    );
  },

  submitProspect: (website: string, options?: SubmitProspectOptions) => {
    const payload: {
      website: string;
      firstTouchStatus?: FirstTouchStatus;
      firstTouchType?: FirstTouchType;
      firstTouchDate?: string;
      firstTouchNotes?: string;
      relationshipWarmth?: RelationshipWarmth;
      closePreference?: ClosePreference;
    } = { website };
    if (options?.firstTouchStatus) payload.firstTouchStatus = options.firstTouchStatus;
    if (options?.firstTouchType) payload.firstTouchType = options.firstTouchType;
    if (options?.firstTouchDate) payload.firstTouchDate = options.firstTouchDate;
    if (options?.firstTouchNotes) payload.firstTouchNotes = options.firstTouchNotes;
    if (options?.relationshipWarmth) payload.relationshipWarmth = options.relationshipWarmth;
    if (options?.closePreference) payload.closePreference = options.closePreference;
    return affiliateRequest<{ prospect: { slug: string; name: string; onboardingStatus: string } }>(
      "/prospects",
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  getProspect: (slug: string) =>
    affiliateRequest<{ prospect: AffiliateProspect }>(`/prospects/${slug}`),

  updateNotes: (slug: string, body: { affiliateNotes?: string; storeNotes?: string }) =>
    affiliateRequest<{ ok: boolean }>(`/prospects/${slug}/notes`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  updateProspect: (slug: string, body: { name?: string; location?: string; website?: string }) =>
    affiliateRequest<{ ok: boolean }>(`/prospects/${slug}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  forgotPassword: (email: string) =>
    affiliateRequest<{ ok: boolean }>("/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    affiliateRequest<{ ok: boolean }>("/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  getLead: (id: string) =>
    affiliateRequest<{ lead: AffiliateLead }>(`/leads/${id}`),

  getLeadTimeline: (id: string) =>
    affiliateRequest<LeadTimelineResponse>(`/leads/${id}/timeline`),
};
