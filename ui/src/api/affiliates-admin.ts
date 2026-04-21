import type { Commission, Payout, PayoutMethod } from "./affiliates";

export interface AdminAffiliate {
  id: string;
  name: string;
  email: string;
  status: string;          // "pending" | "active" | "suspended"
  commissionRate: string;  // e.g. "0.10"
  prospectCount: number;
  convertedCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Phase 4 — Compliance / Engagement / Tiers / Campaigns / Merch
// ---------------------------------------------------------------------------

export type ViolationSeverity = "low" | "medium" | "high" | "critical";
export type ViolationStatus = "open" | "acknowledged" | "overturned" | "enforced";
export type CommissionAction = "none" | "clawback";

export interface ViolationEvidence {
  source: string;
  excerpt: string;
  matchedPattern?: string;
}

export interface AdminViolation {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  leadId?: string | null;
  leadName?: string | null;
  ruleCode: string;
  severity: ViolationSeverity | string;
  detectionType: string;
  evidence: ViolationEvidence;
  status: ViolationStatus | string;
  commissionsClawedBack: number;
  createdAt: string;
}

export interface ListViolationsFilters {
  affiliateId?: string;
  status?: string;
  severity?: string;
}

export interface CreateViolationPayload {
  affiliateId: string;
  leadId?: string;
  ruleCode: string;
  severity: ViolationSeverity | string;
  evidence: { source: string; excerpt: string };
}

export interface AdminEngagementPost {
  id: string;
  affiliateId: string;
  affiliateName: string;
  campaignId?: string | null;
  campaignName?: string | null;
  postUrl: string;
  hashtagUsed: string;
  score: number;
  giveawayEligible: boolean;
  occurredAt: string;
}

export interface AdminTier {
  id: string;
  name: string;
  displayOrder: number;
  commissionRate: string;       // e.g. "0.10"
  minLifetimeCents: number;
  minActivePartners: number;
  perks: string[];
}

export interface UpdateTierPayload {
  commissionRate?: string;
  minLifetimeCents?: number;
  minActivePartners?: number;
  perks?: string[];
}

export type CampaignStatus = "draft" | "live" | "ended";

export interface AdminCampaign {
  id: string;
  name: string;
  hashtag: string;
  startAt: string;
  endAt: string;
  giveawayPrize: string;
  status: CampaignStatus | string;
}

export interface CampaignPayload {
  name: string;
  hashtag: string;
  startAt: string;
  endAt: string;
  giveawayPrize: string;
  status: CampaignStatus | string;
}

export type MerchRequestStatus =
  | "requested"
  | "approved"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface AdminMerchRequest {
  id: string;
  affiliateId: string;
  affiliateName: string;
  itemType: string;
  sizeOrVariant: string;
  shippingAddress: string;
  status: MerchRequestStatus | string;
  trackingNumber: string | null;
  notes: string | null;
  createdAt: string;
}

export interface UpdateMerchPayload {
  status: MerchRequestStatus | string;
  trackingNumber?: string;
  notes?: string;
}

export interface AdminCommission extends Commission {
  affiliateId: string;
  affiliateName: string;
}

export interface AdminPayout extends Payout {
  affiliateId: string;
  affiliateName: string;
}

export interface ListCommissionsAdminFilters {
  affiliateId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ListPayoutsAdminFilters {
  status?: string;
  month?: string;
  affiliateId?: string;
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/affiliates/admin${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const affiliatesAdminApi = {
  list: () =>
    adminRequest<{ affiliates: AdminAffiliate[] }>("/"),
  updateStatus: (id: string, status: "active" | "pending" | "suspended") =>
    adminRequest<{ ok: boolean }>(`/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),

  // --- Commissions ---
  listCommissionsAdmin: (filters: ListCommissionsAdminFilters = {}) =>
    adminRequest<{ commissions: AdminCommission[]; total: number; limit: number; offset: number }>(
      `/commissions${buildQuery({
        affiliateId: filters.affiliateId,
        status: filters.status,
        from: filters.from,
        to: filters.to,
        limit: filters.limit,
        offset: filters.offset,
      })}`,
    ),

  approveCommission: (id: string, reason?: string) =>
    adminRequest<{ ok: boolean; commission?: AdminCommission }>(`/commissions/${id}/approve`, {
      method: "PUT",
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  reverseCommission: (id: string, reason: string) =>
    adminRequest<{ ok: boolean; commission?: AdminCommission }>(`/commissions/${id}/reverse`, {
      method: "PUT",
      body: JSON.stringify({ reason }),
    }),

  holdCommission: (id: string, reason: string) =>
    adminRequest<{ ok: boolean; commission?: AdminCommission }>(`/commissions/${id}/hold`, {
      method: "PUT",
      body: JSON.stringify({ reason }),
    }),

  // --- Payouts ---
  listPayoutsAdmin: (filters: ListPayoutsAdminFilters = {}) =>
    adminRequest<{ payouts: AdminPayout[]; total: number }>(
      `/payouts${buildQuery({
        status: filters.status,
        month: filters.month,
        affiliateId: filters.affiliateId,
      })}`,
    ),

  markPayoutSent: (id: string, externalId: string, method?: PayoutMethod | string) =>
    adminRequest<{ ok: boolean; payout?: AdminPayout }>(`/payouts/${id}/mark-sent`, {
      method: "PUT",
      body: JSON.stringify(method ? { externalId, method } : { externalId }),
    }),

  markPayoutPaid: (id: string) =>
    adminRequest<{ ok: boolean; payout?: AdminPayout }>(`/payouts/${id}/mark-paid`, {
      method: "PUT",
    }),

  // --- Compliance / Violations ---
  listViolations: (filters: ListViolationsFilters = {}) =>
    adminRequest<AdminViolation[]>(
      `/compliance/violations${buildQuery({
        affiliateId: filters.affiliateId,
        status: filters.status,
        severity: filters.severity,
      })}`,
    ),

  createViolation: (payload: CreateViolationPayload) =>
    adminRequest<AdminViolation>("/compliance/violations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateViolationStatus: (
    id: string,
    toStatus: "acknowledged" | "overturned" | "enforced",
    commissionAction?: CommissionAction,
  ) =>
    adminRequest<{ ok: boolean }>(`/compliance/violations/${id}/status`, {
      method: "PUT",
      body: JSON.stringify(
        commissionAction ? { toStatus, commissionAction } : { toStatus },
      ),
    }),

  suspendAffiliate: (id: string, reason: string) =>
    adminRequest<{ ok: boolean }>(`/affiliates/${id}/suspend`, {
      method: "PUT",
      body: JSON.stringify({ reason }),
    }),

  // --- Engagement ---
  listEngagementPosts: (status?: string) =>
    adminRequest<AdminEngagementPost[]>(
      `/engagement/posts${buildQuery({ status })}`,
    ),

  scoreEngagementPost: (id: string, score: number, giveawayEligible: boolean) =>
    adminRequest<{ ok: boolean }>(`/engagement/posts/${id}/score`, {
      method: "PUT",
      body: JSON.stringify({ score, giveawayEligible }),
    }),

  // --- Tiers ---
  listTiers: () =>
    adminRequest<AdminTier[]>("/tiers"),

  updateTier: (id: string, payload: UpdateTierPayload) =>
    adminRequest<{ ok: boolean }>(`/tiers/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  // --- Promo Campaigns ---
  listCampaigns: () =>
    adminRequest<AdminCampaign[]>("/promo/campaigns"),

  createCampaign: (payload: CampaignPayload) =>
    adminRequest<AdminCampaign>("/promo/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateCampaign: (id: string, payload: Partial<CampaignPayload>) =>
    adminRequest<{ ok: boolean }>(`/promo/campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  // --- Merch ---
  listMerchRequests: (status?: string) =>
    adminRequest<AdminMerchRequest[]>(
      `/merch-requests${buildQuery({ status })}`,
    ),

  updateMerchRequest: (id: string, payload: UpdateMerchPayload) =>
    adminRequest<{ ok: boolean }>(`/merch-requests/${id}/status`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
};
