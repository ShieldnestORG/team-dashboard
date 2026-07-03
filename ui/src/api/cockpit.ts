import { api } from "./client";

export interface EmailHealth {
  account: { email: string; plan?: string };
  stats: {
    requests: number;
    delivered: number;
    hardBounces: number;
    softBounces: number;
    opens: number;
    clicks: number;
  };
  foundingList: { id: 3; total: number };
}

export interface Revenue {
  activeMembers: number;
  monthlyMembers: number;
  annualMembers: number;
  mrrUsd: number;
  newSubs30d: number;
  cancellations30d: number;
}

export interface CockpitMember {
  email: string;
  displayName: string | null;
  status: string | null;
  plan: string | null;
  founding: boolean;
  tier: "free" | "member";
  joinedAt: string | null;
}

export interface MembersResponse {
  counts: { total: number; paying: number; free: number };
  members: CockpitMember[];
}

export const cockpitApi = {
  getEmailHealth: (companyId: string) =>
    api.get<EmailHealth>(`/companies/${companyId}/cockpit/email-health`),
  getRevenue: (companyId: string) =>
    api.get<Revenue>(`/companies/${companyId}/cockpit/revenue`),
  getMembers: (companyId: string, q?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const qs = params.toString();
    return api.get<MembersResponse>(
      `/companies/${companyId}/cockpit/members${qs ? `?${qs}` : ""}`,
    );
  },
};
