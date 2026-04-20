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
};
