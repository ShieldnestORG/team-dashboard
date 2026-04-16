import { api } from "./client.js";

export interface Partner {
  id: string;
  companyId: string;
  slug: string;
  name: string;
  industry: string;
  location: string | null;
  website: string | null;
  description: string | null;
  services: string[] | null;
  socialHandles: Record<string, string> | null;
  contactName: string | null;
  contactEmail: string | null;
  tier: string;
  status: string;
  monthlyFee: number | null;
  referralFeePerClient: number | null;
  contentMentions: number;
  totalClicks: number;
  dashboardToken: string | null;
  partnerSince: string;
  createdAt: string;
  updatedAt: string;

  // Phase 2: Business profile
  address: string | null;
  phone: string | null;
  hours: Record<string, string> | null;
  logoUrl: string | null;
  brandColors: { primary: string; secondary: string; accent: string } | null;
  targetKeywords: string[] | null;
  targetAudience: string | null;

  // Phase 2: Microsite management
  siteUrl: string | null;
  siteRepoUrl: string | null;
  siteDeployStatus: string;
  siteLastDeployedAt: string | null;
  siteConfig: {
    template?: string;
    pages?: string[];
    navItems?: string[];
    ctaText?: string;
    ctaUrl?: string;
  } | null;
  siteVercelProjectId: string | null;

  // Phase 2: Analytics baseline
  baselineAnalytics: {
    capturedAt: string;
    monthlyVisitors?: number;
    domainAuthority?: number;
    topKeywords?: string[];
    sourceBreakdown?: Record<string, number>;
    // Populated by onboarding pipeline
    competitorSites?: { name: string; url: string; summary: string }[];
    businessSummary?: string;
  } | null;
  baselineCapturedAt: string | null;

  // Phase 2: Content tracking
  contentPostCount: number;
  lastContentGeneratedAt: string | null;

  // Onboarding pipeline
  onboardingStatus: string;
  onboardingError: string | null;
  onboardingCompletedAt: string | null;

  // Trusted Companies directory
  featured: boolean;
  featuredOrder: number | null;
  tagline: string | null;

  // Stripe billing
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
}

export interface PartnerMetrics {
  totalClicks: number;
  clicksByDay: { date: string; count: number }[];
  clicksBySource: { source: string | null; count: number }[];
  contentMentions: number;
}

export interface PartnerDashboardData extends PartnerMetrics {
  name: string;
  industry: string;
  website: string | null;
}

export interface PartnerClick {
  id: string;
  partnerSlug: string;
  companyId: string;
  sourceContentId: string | null;
  sourceType: string | null;
  referrer: string | null;
  userAgent: string | null;
  ipHash: string | null;
  clickedAt: string;
  clickOrigin: string;
  visitorType: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface PartnerSiteContent {
  id: string;
  partnerId: string;
  companyId: string;
  slug: string;
  title: string;
  contentType: string;
  body: string;
  metaDescription: string | null;
  keywords: string[] | null;
  status: string;
  publishedAt: string | null;
  publishedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerSiteConfig {
  siteUrl: string | null;
  siteRepoUrl: string | null;
  siteDeployStatus: string;
  siteLastDeployedAt: string | null;
  siteConfig: Partner["siteConfig"];
  siteVercelProjectId: string | null;
}

export interface PartnerPrefillResult {
  name?: string;
  industry: string;
  location?: string;
  description: string;
  services: string[];
  targetKeywords: string[];
  tagline: string;
  brandColors?: { primary: string; secondary: string; accent: string };
  contactInfo?: { phone?: string; address?: string; email?: string };
}

export interface CreatePartnerInput {
  name: string;
  slug?: string;
  industry: string;
  location?: string;
  website?: string;
  description?: string;
  services?: string[];
  socialHandles?: Record<string, string>;
  contactName?: string;
  contactEmail?: string;
  tier?: string;
  referralFeePerClient?: number;
  monthlyFee?: number;
  // Phase 2 fields
  address?: string;
  phone?: string;
  hours?: Record<string, string>;
  logoUrl?: string;
  brandColors?: { primary: string; secondary: string; accent: string };
  targetKeywords?: string[];
  targetAudience?: string;
}

export const partnersApi = {
  list: (opts?: { status?: string; industry?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.industry) params.set("industry", opts.industry);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ partners: Partner[]; total: number }>(`/partners${qs ? `?${qs}` : ""}`);
  },
  get: (slug: string) => api.get<{ partner: Partner }>(`/partners/${slug}`),
  create: (input: CreatePartnerInput) => api.post<{ partner: Partner }>("/partners", input),
  update: (slug: string, updates: Partial<Partner>) => api.put<{ partner: Partner }>(`/partners/${slug}`, updates),
  delete: (slug: string) => api.delete<{ ok: boolean }>(`/partners/${slug}`),
  getMetrics: (slug: string) => api.get<PartnerMetrics>(`/partners/${slug}/metrics`),
  getDashboard: (slug: string, token: string) => api.get<PartnerDashboardData>(`/partners/${slug}/dashboard?token=${token}`),
  prefill: (website: string, name?: string) =>
    api.post<PartnerPrefillResult>("/partners/prefill", { website, name }),
  sendWelcome: (slug: string) =>
    api.post<{ ok: boolean; sentTo: string }>(`/partners/${slug}/send-welcome`, {}),
  triggerOnboarding: (slug: string) =>
    api.post<{ ok: boolean; status: string }>(`/partners/${slug}/onboard`, {}),
  getClicks: (slug: string, opts?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ clicks: PartnerClick[]; total: number }>(`/partners/${slug}/clicks${qs ? `?${qs}` : ""}`);
  },

  // Phase 2: Site management
  site: {
    getConfig: (slug: string) => api.get<PartnerSiteConfig>(`/partners/${slug}/site/config`),
    updateConfig: (slug: string, config: Partial<PartnerSiteConfig>) =>
      api.put<PartnerSiteConfig>(`/partners/${slug}/site/config`, config),
    deploy: (slug: string) =>
      api.post<{ status: string; message: string }>(`/partners/${slug}/site/deploy`, {}),
    getContent: (slug: string, opts?: { limit?: number; offset?: number; status?: string }) => {
      const params = new URLSearchParams();
      if (opts?.limit) params.set("limit", String(opts.limit));
      if (opts?.offset) params.set("offset", String(opts.offset));
      if (opts?.status) params.set("status", opts.status);
      const qs = params.toString();
      return api.get<{ content: PartnerSiteContent[]; total: number }>(
        `/partners/${slug}/site/content${qs ? `?${qs}` : ""}`,
      );
    },
    generateContent: (slug: string) =>
      api.post<{ ok: boolean; contentId: string; title: string }>(`/partners/${slug}/site/generate-content`, {}),
    publishDrafts: (slug: string) =>
      api.post<{ ok: boolean; published: number; total: number }>(`/partners/${slug}/site/publish-drafts`, {}),
    createContent: (slug: string, input: { title: string; body: string; contentType?: string; metaDescription?: string; keywords?: string[] }) =>
      api.post<{ content: PartnerSiteContent }>(`/partners/${slug}/site/content`, input),
    updateContent: (slug: string, contentId: string, updates: Partial<PartnerSiteContent>) =>
      api.put<{ content: PartnerSiteContent }>(`/partners/${slug}/site/content/${contentId}`, updates),
    publishContent: (slug: string, contentId: string) =>
      api.post<{ content: PartnerSiteContent }>(`/partners/${slug}/site/content/${contentId}/publish`, {}),
    getBaseline: (slug: string) =>
      api.get<{ baseline: Partner["baselineAnalytics"]; capturedAt: string | null }>(`/partners/${slug}/site/baseline`),
    setBaseline: (slug: string, data: { monthlyVisitors?: number; domainAuthority?: number; topKeywords?: string[]; sourceBreakdown?: Record<string, number> }) =>
      api.post<{ baseline: Partner["baselineAnalytics"] }>(`/partners/${slug}/site/baseline`, data),
  },

  // Phase 3: Public directory
  directory: () => api.get<{ partners: Partner[] }>("/partners/directory"),
};
