import { api } from "./client.js";

export interface IntelPlan {
  slug: string;
  name: string;
  priceCents: number;
  monthlyRequestQuota: number;
  rateLimitPerMin: number;
  overagePriceCentsPer1k: number;
}

export interface IntelUsageSummary {
  email: string;
  status: string;
  plan: {
    name: string;
    slug: string;
    quota: number;
    rateLimitPerMin: number;
  };
  usage: {
    requestCount: number;
    overageCount: number;
    periodStart: string;
  };
}

export interface IntelCustomerRow {
  id: string;
  email: string;
  status: string;
  planSlug: string | null;
  planName: string | null;
  priceCents: number | null;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export const intelBillingApi = {
  listPlans: () => api.get<{ plans: IntelPlan[] }>("/intel-billing/plans"),
  checkout: (planSlug: string, email: string) =>
    api.post<{ url: string }>("/intel-billing/checkout", { planSlug, email }),
  listCustomers: () =>
    api.get<{ customers: IntelCustomerRow[]; mrrCents: number }>("/intel-billing/customers"),
  me: (rawKey: string) =>
    fetch("/api/intel-billing/me", {
      headers: { Authorization: `Bearer ${rawKey}` },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      return (await r.json()) as IntelUsageSummary;
    }),
};
