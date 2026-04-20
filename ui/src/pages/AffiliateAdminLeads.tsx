import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "@/lib/router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { MoreHorizontal, StickyNote, UserCog, ExternalLink, Inbox } from "lucide-react";

import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  affiliateAdminLeadsApi,
  type AdminLeadSummary,
  type LeadStatus,
  type ListAdminLeadsFilters,
  type AdminRep,
  ATTRIBUTION_TYPE_BADGE,
  ATTRIBUTION_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  PRIMARY_LEAD_COLUMNS,
  SECONDARY_LEAD_COLUMNS,
  daysSince,
} from "@/api/affiliate-admin";
import { affiliatesAdminApi, type AdminAffiliate } from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

// "More" virtual column — drops on this column do NOT trigger a status change
// (status is ambiguous across secondary stages); it's a display bucket only.
const MORE_COLUMN_ID = "__more__";

const ATTRIBUTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All attributions" },
  { value: "affiliate_submitted", label: "Affiliate submitted" },
  { value: "affiliate_referral", label: "Affiliate referral" },
  { value: "self_generated", label: "Self generated" },
  { value: "partner_sourced", label: "Partner sourced" },
  { value: "transferred", label: "Transferred" },
  { value: "disputed", label: "Disputed" },
];

function columnIdForDrop(dropId: string, leads: AdminLeadSummary[]): LeadStatus | null {
  if (dropId === MORE_COLUMN_ID) return null;
  if (PRIMARY_LEAD_COLUMNS.includes(dropId as LeadStatus)) {
    return dropId as LeadStatus;
  }
  // Dropped on a card — resolve via the card's lead.
  const lead = leads.find((l) => l.id === dropId);
  if (!lead) return null;
  if (PRIMARY_LEAD_COLUMNS.includes(lead.status as LeadStatus)) {
    return lead.status as LeadStatus;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface CardProps {
  lead: AdminLeadSummary;
  onReassign: (lead: AdminLeadSummary) => void;
  onAddNote: (lead: AdminLeadSummary) => void;
  dragOverlay?: boolean;
}

function LeadCard({ lead, onReassign, onAddNote, dragOverlay }: CardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id, data: { lead } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const days = daysSince(lead.pipelineEnteredAt);
  const lastActivity = lead.lastActivityAt ? daysSince(lead.lastActivityAt) : null;

  const attributionClass =
    ATTRIBUTION_TYPE_BADGE[lead.attributionType] ??
    "bg-muted text-muted-foreground border-border";
  const attributionLabel =
    ATTRIBUTION_TYPE_LABEL[lead.attributionType] ?? lead.attributionType;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-md border bg-card p-2.5 transition-shadow ${
        isDragging && !dragOverlay ? "opacity-30" : ""
      } ${dragOverlay ? "shadow-lg ring-1 ring-[#ff876d]/30" : "hover:shadow-sm"}`}
    >
      {/* Drag handle covers whole card except explicit interactive areas */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-sm font-medium leading-snug line-clamp-2">
            {lead.leadName}
          </p>
        </div>
        <p className="text-xs text-muted-foreground mb-2 truncate">{lead.affiliateName}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${attributionClass}`}
          >
            {attributionLabel}
          </span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
              days > 14
                ? "bg-red-500/10 text-red-600 border-red-500/20"
                : days > 7
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : "bg-muted text-muted-foreground border-border"
            }`}
            title={`Entered ${LEAD_STATUS_LABEL[lead.status] ?? lead.status} on ${new Date(lead.pipelineEnteredAt).toLocaleString()}`}
          >
            {days}d in stage
          </span>
          {lastActivity != null && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-muted text-muted-foreground border-border"
              title={`Last activity ${new Date(lead.lastActivityAt!).toLocaleString()}`}
            >
              act {lastActivity}d
            </span>
          )}
          {lead.assignedRepName && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-slate-500/10 text-slate-700 border-slate-500/20 max-w-[8rem] truncate"
              title={`Assigned rep: ${lead.assignedRepName}`}
            >
              {lead.assignedRepName}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions — not part of drag handle. Visible on hover/focus. */}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              aria-label="Quick actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onReassign(lead)}>
              <UserCog className="h-3.5 w-3.5 mr-2" />
              Reassign rep
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAddNote(lead)}>
              <StickyNote className="h-3.5 w-3.5 mr-2" />
              Add note
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to={`/affiliates/leads/${lead.id}`} className="flex items-center">
                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                View full
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function KanbanColumn({
  id,
  label,
  leads,
  onReassign,
  onAddNote,
  droppable,
}: {
  id: string;
  label: string;
  leads: AdminLeadSummary[];
  onReassign: (l: AdminLeadSummary) => void;
  onAddNote: (l: AdminLeadSummary) => void;
  droppable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable });

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className="flex items-center gap-2 px-2 py-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-xs text-muted-foreground/60 ml-auto tabular-nums">
          {leads.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[160px] rounded-md p-1 space-y-1 transition-colors ${
          isOver ? "bg-accent/40" : "bg-muted/20"
        }`}
      >
        <SortableContext
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onReassign={onReassign}
              onAddNote={onAddNote}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog state
// ---------------------------------------------------------------------------

interface NoteDialogState {
  open: boolean;
  lead: AdminLeadSummary | null;
  note: string;
  visibleToAffiliate: boolean;
  loading: boolean;
  error: string | null;
}

interface ReassignDialogState {
  open: boolean;
  lead: AdminLeadSummary | null;
  repId: string;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateAdminLeads() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [leads, setLeads] = useState<AdminLeadSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [affiliates, setAffiliates] = useState<AdminAffiliate[]>([]);
  const [reps, setReps] = useState<AdminRep[]>([]);
  const [repsUnavailable, setRepsUnavailable] = useState(false);

  // Filters from URL. We keep status/assignedRep/affiliate/attribution as
  // query params so that the Attribution tab can deep-link to this page
  // with status=DuplicateReview prefilled.
  const filterStatus = searchParams.get("status") ?? "";
  const filterRep = searchParams.get("assignedRepId") ?? "";
  const filterAffiliate = searchParams.get("affiliateId") ?? "";
  const filterAttribution = searchParams.get("attributionType") ?? "";
  const viewMode = searchParams.get("view") === "attribution" ? "attribution" : "leads";

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeLead = useMemo(
    () => (activeId ? leads.find((l) => l.id === activeId) ?? null : null),
    [activeId, leads],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const [noteDialog, setNoteDialog] = useState<NoteDialogState>({
    open: false,
    lead: null,
    note: "",
    visibleToAffiliate: false,
    loading: false,
    error: null,
  });

  const [reassignDialog, setReassignDialog] = useState<ReassignDialogState>({
    open: false,
    lead: null,
    repId: "",
    loading: false,
    error: null,
  });

  // ---------------------------------------------------------------------------
  // Breadcrumbs
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (viewMode === "attribution") {
      setBreadcrumbs([
        { label: "Affiliates", href: "/affiliates" },
        { label: "Attribution" },
      ]);
    } else {
      setBreadcrumbs([
        { label: "Affiliates", href: "/affiliates" },
        { label: "Leads" },
      ]);
    }
  }, [setBreadcrumbs, viewMode]);

  // ---------------------------------------------------------------------------
  // Fetch supporting dropdown data
  // ---------------------------------------------------------------------------

  useEffect(() => {
    affiliatesAdminApi.list()
      .then((res) => setAffiliates(res.affiliates))
      .catch(() => { /* non-fatal — affiliate filter just won't populate */ });
  }, []);

  useEffect(() => {
    affiliateAdminLeadsApi.listReps()
      .then((res) => setReps(res.reps))
      .catch(() => { setRepsUnavailable(true); });
  }, []);

  // ---------------------------------------------------------------------------
  // Lead list fetch
  // ---------------------------------------------------------------------------

  const filters = useMemo<ListAdminLeadsFilters>(() => ({
    status: filterStatus || undefined,
    assignedRepId: filterRep || undefined,
    affiliateId: filterAffiliate || undefined,
    attributionType: filterAttribution || undefined,
    // Kanban needs all active leads in view — over-fetch here since the
    // server paginates. 500 is a pragmatic ceiling; if pipelines grow past
    // that we'll add per-column pagination.
    limit: 500,
    offset: 0,
  }), [filterStatus, filterRep, filterAffiliate, filterAttribution]);

  const refresh = useCallback(async () => {
    const res = await affiliateAdminLeadsApi.list(filters);
    setLeads(res.leads);
    setTotal(res.total);
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load leads"))
      .finally(() => setLoading(false));
  }, [refresh]);

  // ---------------------------------------------------------------------------
  // Column grouping
  // ---------------------------------------------------------------------------

  const { columnLeads, moreLeads } = useMemo(() => {
    const grouped: Record<string, AdminLeadSummary[]> = {};
    for (const col of PRIMARY_LEAD_COLUMNS) grouped[col] = [];
    const more: AdminLeadSummary[] = [];
    for (const lead of leads) {
      if (PRIMARY_LEAD_COLUMNS.includes(lead.status as LeadStatus)) {
        grouped[lead.status]!.push(lead);
      } else {
        more.push(lead);
      }
    }
    return { columnLeads: grouped, moreLeads: more };
  }, [leads]);

  // ---------------------------------------------------------------------------
  // Filter helpers
  // ---------------------------------------------------------------------------

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: false });
  }

  function resetFilters() {
    const next = new URLSearchParams();
    if (viewMode === "attribution") next.set("view", "attribution");
    setSearchParams(next, { replace: false });
  }

  const hasActiveFilter = Boolean(
    filterStatus || filterRep || filterAffiliate || filterAttribution,
  );

  // ---------------------------------------------------------------------------
  // Drag & drop — status transition
  // ---------------------------------------------------------------------------

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setActionError(null);
  }

  // Keep previous column state so we can revert on API failure.
  const previousLeadsRef = useRef<AdminLeadSummary[] | null>(null);

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const leadId = active.id as string;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    const target = columnIdForDrop(over.id as string, leads);
    if (!target) return;
    if (target === lead.status) return;

    // Optimistic update
    previousLeadsRef.current = leads;
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? { ...l, status: target, pipelineEnteredAt: new Date().toISOString() }
          : l,
      ),
    );

    try {
      await affiliateAdminLeadsApi.updateStatus(leadId, target);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update status");
      if (previousLeadsRef.current) setLeads(previousLeadsRef.current);
    } finally {
      previousLeadsRef.current = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Dialog handlers
  // ---------------------------------------------------------------------------

  function openReassign(lead: AdminLeadSummary) {
    setReassignDialog({
      open: true,
      lead,
      repId: lead.assignedRepId ?? "",
      loading: false,
      error: null,
    });
  }
  function closeReassign() {
    if (reassignDialog.loading) return;
    setReassignDialog({ open: false, lead: null, repId: "", loading: false, error: null });
  }
  async function submitReassign() {
    if (!reassignDialog.lead) return;
    const repId = reassignDialog.repId.trim();
    if (!repId) {
      setReassignDialog((d) => ({ ...d, error: "Rep is required" }));
      return;
    }
    setReassignDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.assign(reassignDialog.lead.id, repId);
      await refresh();
      closeReassign();
    } catch (err) {
      setReassignDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to reassign",
      }));
    }
  }

  function openNote(lead: AdminLeadSummary) {
    setNoteDialog({
      open: true,
      lead,
      note: "",
      visibleToAffiliate: false,
      loading: false,
      error: null,
    });
  }
  function closeNote() {
    if (noteDialog.loading) return;
    setNoteDialog({
      open: false,
      lead: null,
      note: "",
      visibleToAffiliate: false,
      loading: false,
      error: null,
    });
  }
  async function submitNote() {
    if (!noteDialog.lead) return;
    const note = noteDialog.note.trim();
    if (note.length < 2) {
      setNoteDialog((d) => ({ ...d, error: "Note is required" }));
      return;
    }
    setNoteDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      await affiliateAdminLeadsApi.addNote(noteDialog.lead.id, note, noteDialog.visibleToAffiliate);
      await refresh();
      closeNote();
    } catch (err) {
      setNoteDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to add note",
      }));
    }
  }

  // Attribution view = same data, just default-filtered to DuplicateReview.
  // We seed the filter when the view is attribution and no explicit status
  // filter is set.
  useEffect(() => {
    if (viewMode === "attribution" && !filterStatus) {
      const next = new URLSearchParams(searchParams);
      next.set("status", "DuplicateReview");
      setSearchParams(next, { replace: true });
    }
    // Only react to viewMode / filterStatus changes. Including searchParams
    // here would loop because setSearchParams mutates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, filterStatus]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading && leads.length === 0) return <PageSkeleton variant="list" />;

  const header = viewMode === "attribution" ? (
    <div>
      <h1 className="text-xl font-semibold">Attribution Disputes</h1>
      <p className="text-sm text-muted-foreground">
        Leads flagged for duplicate or attribution review.{" "}
        <button
          type="button"
          onClick={() => navigate({
            pathname: "/affiliates/leads",
            search: filterStatus ? `?status=${filterStatus}` : "",
          })}
          className="text-[#ff876d] hover:underline"
        >
          Open full board
        </button>
      </p>
    </div>
  ) : (
    <div>
      <h1 className="text-xl font-semibold">Leads</h1>
      <p className="text-sm text-muted-foreground">
        CRM kanban — drag cards between columns to transition stage.
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      {header}

      <AffiliateAdminTabs active={viewMode === "attribution" ? "attribution" : "leads"} />

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilter("status", e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              <option value="">All statuses</option>
              {[...PRIMARY_LEAD_COLUMNS, ...SECONDARY_LEAD_COLUMNS].map((s) => (
                <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Assigned rep</label>
            {repsUnavailable ? (
              <input
                type="text"
                value={filterRep}
                onChange={(e) => setFilter("assignedRepId", e.target.value)}
                placeholder="rep id…"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
              />
            ) : (
              <select
                value={filterRep}
                onChange={(e) => setFilter("assignedRepId", e.target.value)}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
              >
                <option value="">All reps</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Affiliate</label>
            <select
              value={filterAffiliate}
              onChange={(e) => setFilter("affiliateId", e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              <option value="">All affiliates</option>
              {affiliates.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Attribution</label>
            <select
              value={filterAttribution}
              onChange={(e) => setFilter("attributionType", e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              {ATTRIBUTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        {hasActiveFilter && (
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
            <span className="text-xs text-muted-foreground">{total} leads match</span>
          </div>
        )}
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Kanban */}
      {leads.length === 0 && !loading ? (
        <EmptyState
          icon={Inbox}
          message={
            hasActiveFilter
              ? "No leads match the current filters."
              : "No leads in the pipeline yet."
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 overflow-x-auto pb-4 -mx-2 px-2">
            {PRIMARY_LEAD_COLUMNS.map((status) => (
              <KanbanColumn
                key={status}
                id={status}
                label={LEAD_STATUS_LABEL[status] ?? status}
                leads={columnLeads[status] ?? []}
                onReassign={openReassign}
                onAddNote={openNote}
                droppable
              />
            ))}
            <KanbanColumn
              id={MORE_COLUMN_ID}
              label="More"
              leads={moreLeads}
              onReassign={openReassign}
              onAddNote={openNote}
              droppable={false}
            />
          </div>
          <DragOverlay>
            {activeLead ? (
              <LeadCard
                lead={activeLead}
                onReassign={openReassign}
                onAddNote={openNote}
                dragOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Reassign dialog */}
      <Dialog open={reassignDialog.open} onOpenChange={(o) => { if (!o) closeReassign(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign rep</DialogTitle>
            {reassignDialog.lead && (
              <DialogDescription>
                <span className="font-semibold text-foreground">{reassignDialog.lead.leadName}</span>
                {" · "}
                {reassignDialog.lead.affiliateName}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-2">
            <label className="block text-xs font-medium">Rep</label>
            {repsUnavailable ? (
              <input
                type="text"
                value={reassignDialog.repId}
                onChange={(e) => setReassignDialog((d) => ({ ...d, repId: e.target.value }))}
                disabled={reassignDialog.loading}
                placeholder="rep id"
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              />
            ) : (
              <select
                value={reassignDialog.repId}
                onChange={(e) => setReassignDialog((d) => ({ ...d, repId: e.target.value }))}
                disabled={reassignDialog.loading}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              >
                <option value="">Select rep…</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
            {reassignDialog.error && (
              <p className="text-xs text-destructive">{reassignDialog.error}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeReassign} disabled={reassignDialog.loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitReassign}
              disabled={reassignDialog.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {reassignDialog.loading ? "Saving…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add note dialog */}
      <Dialog open={noteDialog.open} onOpenChange={(o) => { if (!o) closeNote(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add note</DialogTitle>
            {noteDialog.lead && (
              <DialogDescription>
                <span className="font-semibold text-foreground">{noteDialog.lead.leadName}</span>
                {" · "}
                {noteDialog.lead.affiliateName}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              value={noteDialog.note}
              onChange={(e) => setNoteDialog((d) => ({ ...d, note: e.target.value }))}
              disabled={noteDialog.loading}
              rows={4}
              placeholder="Context, next steps, or a recap…"
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
            />
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={noteDialog.visibleToAffiliate}
                onChange={(e) => setNoteDialog((d) => ({ ...d, visibleToAffiliate: e.target.checked }))}
                disabled={noteDialog.loading}
                className="rounded border-border"
              />
              Visible to affiliate
            </label>
            {noteDialog.error && (
              <p className="text-xs text-destructive">{noteDialog.error}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeNote} disabled={noteDialog.loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitNote}
              disabled={noteDialog.loading}
              className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
            >
              {noteDialog.loading ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
