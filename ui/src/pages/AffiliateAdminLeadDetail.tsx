import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@/lib/router";
import {
  ArrowLeft,
  Globe,
  MapPin,
  Tag,
  UserCircle2,
  ShieldAlert,
  ArrowRightLeft,
  GitBranch,
  Users,
  StickyNote,
  History,
} from "lucide-react";

import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  affiliateAdminLeadsApi,
  type AdminLeadActivity,
  type AdminLeadDetail,
  type AdminRep,
  type AttributionType,
  type LeadStatus,
  ATTRIBUTION_TYPE_BADGE,
  ATTRIBUTION_TYPE_LABEL,
  LEAD_STATUS_BADGE,
  LEAD_STATUS_LABEL,
  PRIMARY_LEAD_COLUMNS,
  SECONDARY_LEAD_COLUMNS,
  daysSince,
} from "@/api/affiliate-admin";
import { affiliatesAdminApi, type AdminAffiliate } from "@/api/affiliates-admin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

const ATTRIBUTION_TYPE_OPTIONS: { value: AttributionType; label: string }[] = [
  { value: "affiliate_submitted", label: "Affiliate submitted" },
  { value: "affiliate_referral", label: "Affiliate referral" },
  { value: "self_generated", label: "Self generated" },
  { value: "partner_sourced", label: "Partner sourced" },
  { value: "transferred", label: "Transferred" },
  { value: "disputed", label: "Disputed" },
];

function StatusBadge({ status }: { status: string }) {
  const cls = LEAD_STATUS_BADGE[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {LEAD_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function AttributionBadge({ type }: { type: string }) {
  const cls = ATTRIBUTION_TYPE_BADGE[type] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {ATTRIBUTION_TYPE_LABEL[type] ?? type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

function ActivityRow({ activity }: { activity: AdminLeadActivity }) {
  const adminOnly = !activity.visibleToAffiliate;
  const actor = activity.actorName ?? activity.actorType;
  return (
    <div className="border-l-2 border-border pl-3 py-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{actor}</span>
        <span className="uppercase tracking-wide text-[10px]">{activity.type.replace(/_/g, " ")}</span>
        <span>· {formatDateTime(activity.createdAt)}</span>
        {adminOnly && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium border bg-slate-500/10 text-slate-600 border-slate-500/20">
            admin only
          </span>
        )}
      </div>
      {activity.note && (
        <p className="mt-0.5 text-sm text-foreground whitespace-pre-wrap">{activity.note}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog state
// ---------------------------------------------------------------------------

interface StatusDialogState {
  open: boolean;
  toStatus: LeadStatus | "";
  note: string;
  loading: boolean;
  error: string | null;
}

interface AssignDialogState {
  open: boolean;
  repId: string;
  loading: boolean;
  error: string | null;
}

interface NoteDialogState {
  open: boolean;
  note: string;
  visibleToAffiliate: boolean;
  loading: boolean;
  error: string | null;
}

interface TransferDialogState {
  open: boolean;
  newAffiliateId: string;
  reason: string;
  loading: boolean;
  error: string | null;
}

interface AttributionDialogState {
  open: boolean;
  attributionType: AttributionType | "";
  reason: string;
  loading: boolean;
  error: string | null;
}

interface ResolveDupDialogState {
  open: boolean;
  winnerAffiliateId: string;
  reason: string;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateAdminLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [lead, setLead] = useState<AdminLeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reps, setReps] = useState<AdminRep[]>([]);
  const [repsUnavailable, setRepsUnavailable] = useState(false);
  const [affiliates, setAffiliates] = useState<AdminAffiliate[]>([]);

  const [statusDialog, setStatusDialog] = useState<StatusDialogState>({
    open: false, toStatus: "", note: "", loading: false, error: null,
  });
  const [assignDialog, setAssignDialog] = useState<AssignDialogState>({
    open: false, repId: "", loading: false, error: null,
  });
  const [noteDialog, setNoteDialog] = useState<NoteDialogState>({
    open: false, note: "", visibleToAffiliate: false, loading: false, error: null,
  });
  const [transferDialog, setTransferDialog] = useState<TransferDialogState>({
    open: false, newAffiliateId: "", reason: "", loading: false, error: null,
  });
  const [attributionDialog, setAttributionDialog] = useState<AttributionDialogState>({
    open: false, attributionType: "", reason: "", loading: false, error: null,
  });
  const [resolveDupDialog, setResolveDupDialog] = useState<ResolveDupDialogState>({
    open: false, winnerAffiliateId: "", reason: "", loading: false, error: null,
  });

  const refresh = useCallback(async () => {
    if (!id) return;
    const res = await affiliateAdminLeadsApi.get(id);
    setLead(res.lead);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load lead"))
      .finally(() => setLoading(false));
  }, [id, refresh]);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Affiliates", href: "/affiliates" },
      { label: "Leads", href: "/affiliates/leads" },
      { label: lead?.leadName ?? "Lead" },
    ]);
  }, [setBreadcrumbs, lead?.leadName]);

  useEffect(() => {
    affiliateAdminLeadsApi.listReps()
      .then((res) => setReps(res.reps))
      .catch(() => setRepsUnavailable(true));
    affiliatesAdminApi.list()
      .then((res) => setAffiliates(res.affiliates))
      .catch(() => { /* non-fatal */ });
  }, []);

  const otherAffiliates = useMemo(
    () => affiliates.filter((a) => a.id !== lead?.affiliateId),
    [affiliates, lead?.affiliateId],
  );

  // ---------------------------------------------------------------------------
  // Dialog submissions
  // ---------------------------------------------------------------------------

  async function submitStatus() {
    if (!lead || !statusDialog.toStatus) return;
    setStatusDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.updateStatus(
        lead.id,
        statusDialog.toStatus,
        statusDialog.note.trim() || undefined,
      );
      await refresh();
      setStatusDialog({ open: false, toStatus: "", note: "", loading: false, error: null });
    } catch (err) {
      setStatusDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to update status",
      }));
    }
  }

  async function submitAssign() {
    if (!lead) return;
    const repId = assignDialog.repId.trim();
    if (!repId) {
      setAssignDialog((d) => ({ ...d, error: "Rep is required" }));
      return;
    }
    setAssignDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.assign(lead.id, repId);
      await refresh();
      setAssignDialog({ open: false, repId: "", loading: false, error: null });
    } catch (err) {
      setAssignDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to assign",
      }));
    }
  }

  async function submitNote() {
    if (!lead) return;
    const note = noteDialog.note.trim();
    if (note.length < 2) {
      setNoteDialog((d) => ({ ...d, error: "Note is required" }));
      return;
    }
    setNoteDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.addNote(lead.id, note, noteDialog.visibleToAffiliate);
      await refresh();
      setNoteDialog({ open: false, note: "", visibleToAffiliate: false, loading: false, error: null });
    } catch (err) {
      setNoteDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to add note",
      }));
    }
  }

  async function submitTransfer() {
    if (!lead) return;
    const reason = transferDialog.reason.trim();
    if (!transferDialog.newAffiliateId) {
      setTransferDialog((d) => ({ ...d, error: "Target affiliate is required" }));
      return;
    }
    if (reason.length < 3) {
      setTransferDialog((d) => ({ ...d, error: "Reason is required (min 3 characters)" }));
      return;
    }
    setTransferDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.transfer(lead.id, transferDialog.newAffiliateId, reason);
      await refresh();
      setTransferDialog({ open: false, newAffiliateId: "", reason: "", loading: false, error: null });
    } catch (err) {
      setTransferDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to transfer",
      }));
    }
  }

  async function submitAttribution() {
    if (!lead || !attributionDialog.attributionType) return;
    const reason = attributionDialog.reason.trim();
    if (reason.length < 3) {
      setAttributionDialog((d) => ({ ...d, error: "Reason is required (min 3 characters)" }));
      return;
    }
    setAttributionDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.overrideAttribution(
        lead.id,
        attributionDialog.attributionType,
        reason,
      );
      await refresh();
      setAttributionDialog({
        open: false, attributionType: "", reason: "", loading: false, error: null,
      });
    } catch (err) {
      setAttributionDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to override attribution",
      }));
    }
  }

  async function submitResolveDup() {
    if (!lead) return;
    const reason = resolveDupDialog.reason.trim();
    if (!resolveDupDialog.winnerAffiliateId) {
      setResolveDupDialog((d) => ({ ...d, error: "Winner affiliate is required" }));
      return;
    }
    if (reason.length < 3) {
      setResolveDupDialog((d) => ({ ...d, error: "Reason is required (min 3 characters)" }));
      return;
    }
    setResolveDupDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.resolveDuplicate(
        lead.id,
        resolveDupDialog.winnerAffiliateId,
        reason,
      );
      await refresh();
      setResolveDupDialog({
        open: false, winnerAffiliateId: "", reason: "", loading: false, error: null,
      });
    } catch (err) {
      setResolveDupDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to resolve duplicate",
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) return <PageSkeleton variant="detail" />;

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
        <Link
          to="/affiliates/leads"
          className="inline-flex items-center gap-2 text-sm text-[#ff876d] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to leads
        </Link>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Lead not found.</p>
        <Link
          to="/affiliates/leads"
          className="inline-flex items-center gap-2 text-sm text-[#ff876d] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to leads
        </Link>
      </div>
    );
  }

  const days = daysSince(lead.pipelineEnteredAt);

  return (
    <div className="space-y-4">
      <div>
        <Link
          to="/affiliates/leads"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to leads
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{lead.leadName}</h1>
          <p className="text-sm text-muted-foreground">
            {lead.affiliateName} · {days}d in {LEAD_STATUS_LABEL[lead.status] ?? lead.status}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={lead.status} />
            <AttributionBadge type={lead.attributionType} />
            {lead.isDuplicate && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-500/15 text-amber-600 border-amber-500/30">
                <ShieldAlert className="h-3 w-3 mr-1" />
                Duplicate
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatusDialog((d) => ({ ...d, open: true }))}
          >
            <GitBranch className="h-3.5 w-3.5 mr-1.5" />
            Change status
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAssignDialog({
              open: true,
              repId: lead.assignedRepId ?? "",
              loading: false,
              error: null,
            })}
          >
            <UserCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Assign rep
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNoteDialog({
              open: true, note: "", visibleToAffiliate: false, loading: false, error: null,
            })}
          >
            <StickyNote className="h-3.5 w-3.5 mr-1.5" />
            Add note
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTransferDialog({
              open: true, newAffiliateId: "", reason: "", loading: false, error: null,
            })}
          >
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
            Transfer
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAttributionDialog({
              open: true,
              attributionType: (lead.attributionType as AttributionType) || "",
              reason: "",
              loading: false,
              error: null,
            })}
          >
            Override attribution
          </Button>
          {lead.isDuplicate && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
              onClick={() => setResolveDupDialog({
                open: true, winnerAffiliateId: lead.affiliateId, reason: "", loading: false, error: null,
              })}
            >
              <Users className="h-3.5 w-3.5 mr-1.5" />
              Resolve duplicate
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Business info */}
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Business</h3>
            {lead.website && (
              <div className="flex items-start gap-2 text-sm">
                <Globe className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#ff876d] hover:underline"
                >
                  {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              </div>
            )}
            {lead.location && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                <span>{lead.location}</span>
              </div>
            )}
            {lead.industry && (
              <div className="flex items-start gap-2 text-sm">
                <Tag className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                <span>{lead.industry}</span>
              </div>
            )}
            {lead.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{lead.description}</p>
            )}
            {!lead.website && !lead.location && !lead.industry && !lead.description && (
              <p className="text-xs text-muted-foreground italic">No business metadata recorded.</p>
            )}
          </Card>

          {/* First touch */}
          {lead.firstTouch && (
            <Card className="p-4 space-y-1.5">
              <h3 className="text-sm font-semibold mb-1">First touch</h3>
              <div className="grid grid-cols-2 gap-y-1 text-xs">
                <span className="text-muted-foreground">Type</span>
                <span>{lead.firstTouch.type ?? "—"}</span>
                <span className="text-muted-foreground">Date</span>
                <span>{formatDate(lead.firstTouch.date)}</span>
                <span className="text-muted-foreground">Warmth</span>
                <span>{lead.firstTouch.warmth ?? "—"}</span>
                <span className="text-muted-foreground">Close path</span>
                <span>{lead.firstTouch.closePath ?? "—"}</span>
              </div>
              {lead.firstTouch.notes && (
                <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
                  {lead.firstTouch.notes}
                </p>
              )}
            </Card>
          )}

          {/* Activity feed */}
          <Card className="p-4 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <History className="h-3.5 w-3.5" />
              Activity
              <span className="text-xs font-normal text-muted-foreground">
                {lead.activities.length}
              </span>
            </h3>
            {lead.activities.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No activity recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {lead.activities.map((a) => (
                  <ActivityRow key={a.id} activity={a} />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="p-4 space-y-2">
            <h3 className="text-sm font-semibold">Assignment</h3>
            <div className="text-xs grid grid-cols-2 gap-y-1">
              <span className="text-muted-foreground">Rep</span>
              <span className="font-medium">{lead.assignedRepName ?? "Unassigned"}</span>
              <span className="text-muted-foreground">Affiliate</span>
              <span className="font-medium">{lead.affiliateName}</span>
              <span className="text-muted-foreground">Pipeline entered</span>
              <span>{formatDateTime(lead.pipelineEnteredAt)}</span>
              <span className="text-muted-foreground">Last activity</span>
              <span>{formatDateTime(lead.lastActivityAt)}</span>
              <span className="text-muted-foreground">Created</span>
              <span>{formatDateTime(lead.createdAt)}</span>
            </div>
          </Card>

          {/* Attribution history */}
          <Card className="p-4 space-y-2">
            <h3 className="text-sm font-semibold">Attribution history</h3>
            {lead.attributionHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No overrides recorded.</p>
            ) : (
              <div className="space-y-2">
                {lead.attributionHistory.map((o) => (
                  <div key={o.id} className="border-l-2 border-border pl-3 py-1">
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(o.createdAt)} · {o.adminName ?? "admin"}
                    </div>
                    <div className="text-xs mt-0.5 flex items-center gap-1 flex-wrap">
                      <AttributionBadge type={o.previousType} />
                      <span className="text-muted-foreground">→</span>
                      <AttributionBadge type={o.newType} />
                    </div>
                    {o.reason && (
                      <p className="text-xs mt-1 text-foreground">{o.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Notes */}
          {(lead.affiliateNotes || lead.storeNotes) && (
            <Card className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">Notes</h3>
              {lead.affiliateNotes && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Affiliate</p>
                  <p className="text-sm whitespace-pre-wrap">{lead.affiliateNotes}</p>
                </div>
              )}
              {lead.storeNotes && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Store</p>
                  <p className="text-sm whitespace-pre-wrap">{lead.storeNotes}</p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Dialogs                                                             */}
      {/* ------------------------------------------------------------------- */}

      {/* Change status */}
      <Dialog
        open={statusDialog.open}
        onOpenChange={(o) => { if (!o && !statusDialog.loading) setStatusDialog((d) => ({ ...d, open: false })); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change status</DialogTitle>
            <DialogDescription>Select a new stage for this lead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">New status</label>
              <select
                value={statusDialog.toStatus}
                onChange={(e) => setStatusDialog((d) => ({ ...d, toStatus: e.target.value as LeadStatus }))}
                disabled={statusDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                <option value="">Select status…</option>
                {[...PRIMARY_LEAD_COLUMNS, ...SECONDARY_LEAD_COLUMNS].map((s) => (
                  <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Note (optional)</label>
              <textarea
                value={statusDialog.note}
                onChange={(e) => setStatusDialog((d) => ({ ...d, note: e.target.value }))}
                disabled={statusDialog.loading}
                rows={3}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
              />
            </div>
            {statusDialog.error && <p className="text-xs text-destructive">{statusDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog((d) => ({ ...d, open: false }))} disabled={statusDialog.loading}>
              Cancel
            </Button>
            <Button
              onClick={submitStatus}
              disabled={statusDialog.loading || !statusDialog.toStatus}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {statusDialog.loading ? "Saving…" : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign rep */}
      <Dialog
        open={assignDialog.open}
        onOpenChange={(o) => { if (!o && !assignDialog.loading) setAssignDialog((d) => ({ ...d, open: false })); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign rep</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="block text-xs font-medium">Rep</label>
            {repsUnavailable ? (
              <input
                type="text"
                value={assignDialog.repId}
                onChange={(e) => setAssignDialog((d) => ({ ...d, repId: e.target.value }))}
                placeholder="rep id"
                disabled={assignDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              />
            ) : (
              <select
                value={assignDialog.repId}
                onChange={(e) => setAssignDialog((d) => ({ ...d, repId: e.target.value }))}
                disabled={assignDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                <option value="">Select rep…</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
            {assignDialog.error && <p className="text-xs text-destructive">{assignDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog((d) => ({ ...d, open: false }))} disabled={assignDialog.loading}>
              Cancel
            </Button>
            <Button
              onClick={submitAssign}
              disabled={assignDialog.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {assignDialog.loading ? "Saving…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add note */}
      <Dialog
        open={noteDialog.open}
        onOpenChange={(o) => { if (!o && !noteDialog.loading) setNoteDialog((d) => ({ ...d, open: false })); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add note</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              value={noteDialog.note}
              onChange={(e) => setNoteDialog((d) => ({ ...d, note: e.target.value }))}
              disabled={noteDialog.loading}
              rows={4}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={noteDialog.visibleToAffiliate}
                onChange={(e) => setNoteDialog((d) => ({ ...d, visibleToAffiliate: e.target.checked }))}
                disabled={noteDialog.loading}
                className="rounded border-border"
              />
              Visible to affiliate
            </label>
            {noteDialog.error && <p className="text-xs text-destructive">{noteDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialog((d) => ({ ...d, open: false }))} disabled={noteDialog.loading}>
              Cancel
            </Button>
            <Button
              onClick={submitNote}
              disabled={noteDialog.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {noteDialog.loading ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer lead */}
      <Dialog
        open={transferDialog.open}
        onOpenChange={(o) => { if (!o && !transferDialog.loading) setTransferDialog((d) => ({ ...d, open: false })); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer lead to another affiliate</DialogTitle>
            <DialogDescription>
              This re-attributes future commissions. Past commissions are unaffected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Target affiliate</label>
              <select
                value={transferDialog.newAffiliateId}
                onChange={(e) => setTransferDialog((d) => ({ ...d, newAffiliateId: e.target.value }))}
                disabled={transferDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                <option value="">Select affiliate…</option>
                {otherAffiliates.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Reason <span className="text-destructive">*</span></label>
              <textarea
                value={transferDialog.reason}
                onChange={(e) => setTransferDialog((d) => ({ ...d, reason: e.target.value }))}
                disabled={transferDialog.loading}
                rows={3}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
              />
            </div>
            {transferDialog.error && <p className="text-xs text-destructive">{transferDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog((d) => ({ ...d, open: false }))} disabled={transferDialog.loading}>
              Cancel
            </Button>
            <Button
              onClick={submitTransfer}
              disabled={transferDialog.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {transferDialog.loading ? "Saving…" : "Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override attribution */}
      <Dialog
        open={attributionDialog.open}
        onOpenChange={(o) => { if (!o && !attributionDialog.loading) setAttributionDialog((d) => ({ ...d, open: false })); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Override attribution</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Attribution type</label>
              <select
                value={attributionDialog.attributionType}
                onChange={(e) => setAttributionDialog((d) => ({ ...d, attributionType: e.target.value as AttributionType }))}
                disabled={attributionDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                <option value="">Select type…</option>
                {ATTRIBUTION_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Reason <span className="text-destructive">*</span></label>
              <textarea
                value={attributionDialog.reason}
                onChange={(e) => setAttributionDialog((d) => ({ ...d, reason: e.target.value }))}
                disabled={attributionDialog.loading}
                rows={3}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
              />
            </div>
            {attributionDialog.error && <p className="text-xs text-destructive">{attributionDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttributionDialog((d) => ({ ...d, open: false }))} disabled={attributionDialog.loading}>
              Cancel
            </Button>
            <Button
              onClick={submitAttribution}
              disabled={attributionDialog.loading || !attributionDialog.attributionType}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {attributionDialog.loading ? "Saving…" : "Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve duplicate */}
      <Dialog
        open={resolveDupDialog.open}
        onOpenChange={(o) => { if (!o && !resolveDupDialog.loading) setResolveDupDialog((d) => ({ ...d, open: false })); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve duplicate</DialogTitle>
            <DialogDescription>
              Pick which affiliate retains attribution. The other side's claim is marked resolved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Winner</label>
              <select
                value={resolveDupDialog.winnerAffiliateId}
                onChange={(e) => setResolveDupDialog((d) => ({ ...d, winnerAffiliateId: e.target.value }))}
                disabled={resolveDupDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                <option value="">Select affiliate…</option>
                {affiliates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.id === lead.affiliateId ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Reason <span className="text-destructive">*</span></label>
              <textarea
                value={resolveDupDialog.reason}
                onChange={(e) => setResolveDupDialog((d) => ({ ...d, reason: e.target.value }))}
                disabled={resolveDupDialog.loading}
                rows={3}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
              />
            </div>
            {resolveDupDialog.error && <p className="text-xs text-destructive">{resolveDupDialog.error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDupDialog((d) => ({ ...d, open: false }))} disabled={resolveDupDialog.loading}>
              Cancel
            </Button>
            <Button
              onClick={submitResolveDup}
              disabled={resolveDupDialog.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {resolveDupDialog.loading ? "Saving…" : "Resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
