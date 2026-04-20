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

export type ProspectFirstTouchType = "in-person" | "call" | "text" | "email" | "social-dm";
export type ProspectFirstTouchWarmth = "strong" | "medium" | "weak";
export type ProspectClosePath = "cd" | "shared" | "affiliate";

export interface ProspectFirstTouchInput {
  logged: boolean;
  type?: ProspectFirstTouchType;
  date?: string;
  notes?: string;
  warmth?: ProspectFirstTouchWarmth;
}

export interface SubmitProspectOptions {
  firstTouch?: ProspectFirstTouchInput;
  closePath?: ProspectClosePath;
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
    affiliateRequest<{ affiliate: Affiliate; prospectCount: number; convertedCount: number; estimatedEarned: number }>("/me"),

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
      firstTouch?: ProspectFirstTouchInput;
      closePath?: ProspectClosePath;
    } = { website };
    if (options?.firstTouch) payload.firstTouch = options.firstTouch;
    if (options?.closePath) payload.closePath = options.closePath;
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
};
