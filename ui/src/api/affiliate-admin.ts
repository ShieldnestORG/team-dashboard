// Admin-side Affiliate Lead / CRM API types + client.
//
// These endpoints are implemented by Agent A under /api/affiliates/admin/leads.
// The client here speaks JSON, uses cookie-based admin auth (credentials:
// "include") — same convention as `ui/src/api/affiliates-admin.ts`.

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// All statuses the server may return on `lead.status`. Kept broad so that
// the UI won't crash if new values ship before types update — unknown
// values still render via a generic fallback badge.
export type LeadStatus =
  | "Draft"
  | "Submitted"
  | "Enriched"
  | "DuplicateReview"
  | "Qualified"
  | "Rejected"
  | "Locked"
  | "Assigned"
  | "Contacted"
  | "AwaitingResponse"
  | "Interested"
  | "DemoScheduled"
  | "ProposalSent"
  | "Negotiation"
  | "Won"
  | "Lost"
  | "Nurture"
  | "Expired";

export type AttributionType =
  | "affiliate_submitted"
  | "affiliate_referral"
  | "self_generated"
  | "partner_sourced"
  | "transferred"
  | "disputed";

export interface AdminLeadSummary {
  id: string;
  affiliateId: string;
  affiliateName: string;
  leadName: string;
  status: LeadStatus | string;
  attributionType: AttributionType | string;
  assignedRepId: string | null;
  assignedRepName: string | null;
  pipelineEnteredAt: string;   // ISO — moment lead entered current stage
  lastActivityAt: string | null;
  createdAt: string;
  isDuplicate: boolean;
  duplicateOfLeadId: string | null;
}

export interface AdminLeadActivity {
  id: string;
  leadId: string;
  type: string;   // "note" | "status_change" | "assignment" | "attribution_override" | "transfer" | "duplicate_resolve" | ...
  actorType: "admin" | "affiliate" | "system";
  actorName: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  visibleToAffiliate: boolean;
  createdAt: string;
}

export interface AdminLeadAttributionOverride {
  id: string;
  leadId: string;
  previousType: AttributionType | string;
  newType: AttributionType | string;
  previousAffiliateId: string | null;
  newAffiliateId: string | null;
  reason: string;
  adminName: string | null;
  createdAt: string;
}

export interface AdminLeadFirstTouch {
  type: string | null;
  date: string | null;
  notes: string | null;
  warmth: string | null;
  closePath: string | null;
}

export interface AdminLeadDetail extends AdminLeadSummary {
  website: string | null;
  location: string | null;
  industry: string | null;
  description: string | null;
  affiliateNotes: string | null;
  storeNotes: string | null;
  firstTouch: AdminLeadFirstTouch | null;
  activities: AdminLeadActivity[];
  attributionHistory: AdminLeadAttributionOverride[];
}

export interface AdminRep {
  id: string;
  name: string;
  email: string;
}

// ---------------------------------------------------------------------------
// List filters + responses
// ---------------------------------------------------------------------------

export interface ListAdminLeadsFilters {
  status?: LeadStatus | string;
  assignedRepId?: string;
  affiliateId?: string;
  attributionType?: AttributionType | string;
  limit?: number;
  offset?: number;
}

export interface ListAdminLeadsResponse {
  leads: AdminLeadSummary[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const affiliateAdminLeadsApi = {
  list: (filters: ListAdminLeadsFilters = {}) =>
    adminRequest<ListAdminLeadsResponse>(
      `/leads${buildQuery({
        status: filters.status,
        assignedRepId: filters.assignedRepId,
        affiliateId: filters.affiliateId,
        attributionType: filters.attributionType,
        limit: filters.limit,
        offset: filters.offset,
      })}`,
    ),

  get: (id: string) =>
    adminRequest<{ lead: AdminLeadDetail }>(`/leads/${id}`),

  updateStatus: (id: string, toStatus: LeadStatus | string, note?: string) =>
    adminRequest<{ ok: boolean; lead?: AdminLeadSummary }>(`/leads/${id}/status`, {
      method: "PUT",
      body: JSON.stringify(note ? { toStatus, note } : { toStatus }),
    }),

  assign: (id: string, repId: string | null) =>
    adminRequest<{ ok: boolean; lead?: AdminLeadSummary }>(`/leads/${id}/assign`, {
      method: "PUT",
      body: JSON.stringify({ repId }),
    }),

  addNote: (id: string, note: string, visibleToAffiliate: boolean) =>
    adminRequest<{ ok: boolean; activity?: AdminLeadActivity }>(`/leads/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ note, visibleToAffiliate }),
    }),

  overrideAttribution: (id: string, attributionType: AttributionType | string, reason: string) =>
    adminRequest<{ ok: boolean; lead?: AdminLeadDetail }>(`/leads/${id}/attribution`, {
      method: "PUT",
      body: JSON.stringify({ attributionType, reason }),
    }),

  transfer: (id: string, newAffiliateId: string, reason: string) =>
    adminRequest<{ ok: boolean; lead?: AdminLeadDetail }>(`/leads/${id}/transfer`, {
      method: "POST",
      body: JSON.stringify({ newAffiliateId, reason }),
    }),

  resolveDuplicate: (id: string, winnerAffiliateId: string, reason: string) =>
    adminRequest<{ ok: boolean; lead?: AdminLeadDetail }>(`/leads/${id}/duplicate-resolve`, {
      method: "POST",
      body: JSON.stringify({ winnerAffiliateId, reason }),
    }),

  // Rep directory (for assign dropdown). Endpoint is optional — if the server
  // doesn't implement it yet, callers should swallow the error and fall back
  // to a free-text rep id input.
  listReps: () =>
    adminRequest<{ reps: AdminRep[] }>(`/reps`),
};

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "Draft",
  "Submitted",
  "Enriched",
  "DuplicateReview",
  "Qualified",
  "Rejected",
  "Locked",
  "Assigned",
  "Contacted",
  "AwaitingResponse",
  "Interested",
  "DemoScheduled",
  "ProposalSent",
  "Negotiation",
  "Won",
  "Lost",
  "Nurture",
  "Expired",
];

// Primary board columns get their own vertical lane. Lower-signal stages
// collapse behind a "More" column to keep the kanban scannable.
export const PRIMARY_LEAD_COLUMNS: LeadStatus[] = [
  "Submitted",
  "Enriched",
  "DuplicateReview",
  "Qualified",
  "Assigned",
  "Contacted",
  "Interested",
  "DemoScheduled",
  "ProposalSent",
  "Negotiation",
  "Won",
];

export const SECONDARY_LEAD_COLUMNS: LeadStatus[] = [
  "Draft",
  "Rejected",
  "Locked",
  "AwaitingResponse",
  "Lost",
  "Nurture",
  "Expired",
];

export const LEAD_STATUS_LABEL: Record<string, string> = {
  Draft: "Draft",
  Submitted: "Submitted",
  Enriched: "Enriched",
  DuplicateReview: "Duplicate Review",
  Qualified: "Qualified",
  Rejected: "Rejected",
  Locked: "Locked",
  Assigned: "Assigned",
  Contacted: "Contacted",
  AwaitingResponse: "Awaiting Response",
  Interested: "Interested",
  DemoScheduled: "Demo Scheduled",
  ProposalSent: "Proposal Sent",
  Negotiation: "Negotiation",
  Won: "Won",
  Lost: "Lost",
  Nurture: "Nurture",
  Expired: "Expired",
};

export const LEAD_STATUS_BADGE: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground border-border",
  Submitted: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  Enriched: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  DuplicateReview: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  Qualified: "bg-violet-500/15 text-violet-600 border-violet-500/30",
  Rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  Locked: "bg-slate-500/15 text-slate-600 border-slate-500/30",
  Assigned: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
  Contacted: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
  AwaitingResponse: "bg-teal-500/15 text-teal-600 border-teal-500/30",
  Interested: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  DemoScheduled: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  ProposalSent: "bg-lime-500/15 text-lime-600 border-lime-500/30",
  Negotiation: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  Won: "bg-green-500/15 text-green-600 border-green-500/30",
  Lost: "bg-red-500/15 text-red-600 border-red-500/30",
  Nurture: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  Expired: "bg-muted text-muted-foreground border-border",
};

export const ATTRIBUTION_TYPE_LABEL: Record<string, string> = {
  affiliate_submitted: "Affiliate",
  affiliate_referral: "Referral",
  self_generated: "Self",
  partner_sourced: "Partner",
  transferred: "Transferred",
  disputed: "Disputed",
};

export const ATTRIBUTION_TYPE_BADGE: Record<string, string> = {
  affiliate_submitted: "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/30",
  affiliate_referral: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  self_generated: "bg-muted text-muted-foreground border-border",
  partner_sourced: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  transferred: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  disputed: "bg-red-500/15 text-red-600 border-red-500/30",
};

/**
 * Integer days from the given ISO timestamp until now, floored. Returns 0 for
 * invalid / future timestamps so cards always show a non-negative number.
 */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  const diff = Date.now() - t;
  if (diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
