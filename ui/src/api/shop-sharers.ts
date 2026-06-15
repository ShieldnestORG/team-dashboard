export interface ShopSharer {
  id: string;
  email: string;
  referralCode: string;
  shareUrl?: string;
  // Canonical attributed link on outrizzd.com (?ref=<code>).
  affiliateUrl?: string;
  affiliateApplicationStatus: string | null;
  affiliateId: string | null;
  sharedMarketingEligible: boolean;
  source: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopCommission {
  id: string;
  referralCode: string;
  sharerEmail: string | null;
  orderRef: string;
  grossAmountCents: number;
  rate: string;
  commissionCents: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface ShopSharerApproveResult {
  sharer: ShopSharer;
  affiliate: { id: string; email: string; name: string; status: string };
  resetToken: string;
}

async function shopRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/shop${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const shopSharersApi = {
  list: (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return shopRequest<{ sharers: ShopSharer[] }>(`/admin/sharers${q}`);
  },

  approve: (id: string, displayName?: string) =>
    shopRequest<ShopSharerApproveResult>(`/admin/sharers/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    }),

  reject: (id: string, notes?: string) =>
    shopRequest<{ sharer: ShopSharer }>(`/admin/sharers/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),

  create: (input: { email: string; referralCode?: string }) =>
    shopRequest<{ sharer: ShopSharer; created: boolean }>(`/admin/sharers`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listCommissions: () =>
    shopRequest<{ commissions: ShopCommission[] }>(`/admin/commissions`),
};
