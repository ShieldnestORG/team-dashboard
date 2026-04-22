import { api } from "./client";

// Shared fields carried by agent-generated review items.
export interface RuleViolations {
  must?: string[];
  should?: string[];
  avoid?: string[];
}

export interface ContentDraft {
  id: string;
  subscriptionId: string;
  domain: string;
  cycleTag: string;
  cycleIndex: number;
  title: string;
  slug: string;
  targetSignal: string | null;
  htmlDraft: string;
  markdownDraft: string | null;
  promptMeta: {
    model?: string;
    signal?: string;
    gap?: number;
    baseScore?: number | null;
    ruleViolations?: string[];
    ruleViolationsBySeverity?: RuleViolations;
  } | null;
  status: "pending_review" | "needs_revision" | "approved" | "rejected" | "published";
  reviewNotes: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchemaImpl {
  id: string;
  subscriptionId: string;
  domain: string;
  cycleTag: string;
  cycleIndex: number;
  schemaType: string;
  jsonLd: Record<string, unknown>;
  htmlSnippet: string;
  promptMeta: {
    model?: string;
    schemaType?: string;
    ruleViolations?: string[];
    ruleViolationsBySeverity?: RuleViolations;
  } | null;
  status: "pending_review" | "needs_revision" | "approved" | "rejected" | "delivered";
  reviewNotes: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorScan {
  id: string;
  subscriptionId: string;
  cycleTag: string;
  competitorDomain: string;
  competitorScore: number | null;
  customerScore: number | null;
  gapSummary: string | null;
  status: string;
  createdAt: string;
}

export interface StrategyDoc {
  id: string;
  subscriptionId: string;
  cycleTag: string;
  weekOf: string;
  docHtml: string;
  docMarkdown: string;
  status: string;
  deliveredAt: string | null;
  createdAt: string;
}

export const creditscoreReviewApi = {
  listContentDrafts: () =>
    api.get<{ drafts: ContentDraft[] }>("/creditscore/content-drafts"),
  getContentDraft: (id: string) =>
    api.get<{ draft: ContentDraft }>(`/creditscore/content-drafts/${id}`),
  approveContentDraft: (id: string, reviewNotes?: string) =>
    api.post<{ ok: true }>(`/creditscore/content-drafts/${id}/approve`, { reviewNotes }),
  rejectContentDraft: (id: string, reviewNotes?: string) =>
    api.post<{ ok: true }>(`/creditscore/content-drafts/${id}/reject`, { reviewNotes }),

  listSchemaImpls: () =>
    api.get<{ impls: SchemaImpl[] }>("/creditscore/schema-impls"),
  getSchemaImpl: (id: string) =>
    api.get<{ impl: SchemaImpl }>(`/creditscore/schema-impls/${id}`),
  approveSchemaImpl: (id: string, reviewNotes?: string) =>
    api.post<{ ok: true }>(`/creditscore/schema-impls/${id}/approve`, { reviewNotes }),
  rejectSchemaImpl: (id: string, reviewNotes?: string) =>
    api.post<{ ok: true }>(`/creditscore/schema-impls/${id}/reject`, { reviewNotes }),

  listCompetitorScans: () =>
    api.get<{ scans: CompetitorScan[] }>("/creditscore/competitor-scans"),

  listStrategyDocs: () =>
    api.get<{ docs: StrategyDoc[] }>("/creditscore/strategy-docs"),
};
