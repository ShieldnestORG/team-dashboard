import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Coins } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  affiliatesAdminApi,
  type AdminAffiliate,
  type AdminCommission,
  type ListCommissionsAdminFilters,
} from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  pending_activation: { label: "Pending", className: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" },
  approved: { label: "Approved", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  scheduled_for_payout: { label: "Scheduled", className: "bg-violet-500/15 text-violet-500 border-violet-500/30" },
  paid: { label: "Paid", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  held: { label: "Held", className: "bg-orange-500/15 text-orange-500 border-orange-500/30" },
  reversed: { label: "Reversed", className: "bg-red-500/15 text-red-500 border-red-500/30" },
  clawed_back: { label: "Clawed Back", className: "bg-red-500/15 text-red-500 border-red-500/30" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? { label: status, className: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending_activation", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "scheduled_for_payout", label: "Scheduled" },
  { value: "paid", label: "Paid" },
  { value: "held", label: "Held" },
  { value: "reversed", label: "Reversed" },
  { value: "clawed_back", label: "Clawed Back" },
];

const PAGE_SIZE = 50;

type DialogMode = "approve" | "reverse" | "hold" | null;

interface ActionDialogState {
  mode: DialogMode;
  commission: AdminCommission | null;
  reason: string;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AffiliateAdminCommissions() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [affiliates, setAffiliates] = useState<AdminAffiliate[]>([]);
  const [commissions, setCommissions] = useState<AdminCommission[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [affiliateId, setAffiliateId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [dialog, setDialog] = useState<ActionDialogState>({
    mode: null,
    commission: null,
    reason: "",
    loading: false,
    error: null,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Commissions" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    affiliatesAdminApi.list()
      .then((res) => setAffiliates(res.affiliates))
      .catch(() => { /* silent — affiliate dropdown is optional */ });
  }, []);

  const filters = useMemo<ListCommissionsAdminFilters>(() => ({
    affiliateId: affiliateId || undefined,
    status: status || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: PAGE_SIZE,
    offset,
  }), [affiliateId, status, from, to, offset]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    affiliatesAdminApi.listCommissionsAdmin(filters)
      .then((res) => {
        setCommissions(res.commissions);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load commissions"))
      .finally(() => setLoading(false));
  }, [filters]);

  function resetFilters() {
    setAffiliateId("");
    setStatus("");
    setFrom("");
    setTo("");
    setOffset(0);
  }

  function openDialog(mode: Exclude<DialogMode, null>, commission: AdminCommission) {
    setDialog({ mode, commission, reason: "", loading: false, error: null });
  }

  function closeDialog() {
    if (dialog.loading) return;
    setDialog({ mode: null, commission: null, reason: "", loading: false, error: null });
  }

  async function handleDialogSubmit() {
    if (!dialog.commission || !dialog.mode) return;
    const { mode, commission, reason } = dialog;
    const trimmed = reason.trim();

    if ((mode === "reverse" || mode === "hold") && trimmed.length < 3) {
      setDialog((d) => ({ ...d, error: "Reason is required (min 3 characters)" }));
      return;
    }

    setDialog((d) => ({ ...d, loading: true, error: null }));
    try {
      if (mode === "approve") {
        await affiliatesAdminApi.approveCommission(commission.id, trimmed || undefined);
      } else if (mode === "reverse") {
        await affiliatesAdminApi.reverseCommission(commission.id, trimmed);
      } else if (mode === "hold") {
        await affiliatesAdminApi.holdCommission(commission.id, trimmed);
      }
      // Refresh list
      const res = await affiliatesAdminApi.listCommissionsAdmin(filters);
      setCommissions(res.commissions);
      setTotal(res.total);
      setDialog({ mode: null, commission: null, reason: "", loading: false, error: null });
    } catch (err) {
      setDialog((d) => ({
        ...d,
        loading: false,
        error: err instanceof Error ? err.message : "Action failed",
      }));
    }
  }

  function renderRowActions(c: AdminCommission) {
    const s = c.status;
    if (s === "pending_activation") {
      return (
        <div className="flex items-center gap-1.5 justify-end">
          <Button size="sm" variant="outline" className="text-xs h-7 border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
            onClick={() => openDialog("approve", c)}>Approve</Button>
          <Button size="sm" variant="outline" className="text-xs h-7 border-orange-500/40 text-orange-600 hover:bg-orange-500/10"
            onClick={() => openDialog("hold", c)}>Hold</Button>
          <Button size="sm" variant="outline" className="text-xs h-7 border-red-500/40 text-red-600 hover:bg-red-500/10"
            onClick={() => openDialog("reverse", c)}>Reverse</Button>
        </div>
      );
    }
    if (s === "approved") {
      return (
        <div className="flex items-center gap-1.5 justify-end">
          <Button size="sm" variant="outline" className="text-xs h-7 border-orange-500/40 text-orange-600 hover:bg-orange-500/10"
            onClick={() => openDialog("hold", c)}>Hold</Button>
          <Button size="sm" variant="outline" className="text-xs h-7 border-red-500/40 text-red-600 hover:bg-red-500/10"
            onClick={() => openDialog("reverse", c)}>Reverse</Button>
        </div>
      );
    }
    if (s === "held") {
      return (
        <div className="flex items-center gap-1.5 justify-end">
          <Button size="sm" variant="outline" className="text-xs h-7 border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
            onClick={() => openDialog("approve", c)}>Approve</Button>
          <Button size="sm" variant="outline" className="text-xs h-7 border-red-500/40 text-red-600 hover:bg-red-500/10"
            onClick={() => openDialog("reverse", c)}>Reverse</Button>
        </div>
      );
    }
    // scheduled_for_payout, paid, reversed, clawed_back — read-only
    const reason = c.clawbackReason ?? null;
    return (
      <span className="text-xs text-muted-foreground italic block text-right">
        {reason ? reason : "—"}
      </span>
    );
  }

  if (loading && commissions.length === 0) return <PageSkeleton variant="list" />;

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Commissions</h1>
        <p className="text-sm text-muted-foreground">Review, approve, hold, or reverse affiliate commissions.</p>
      </div>

      <AffiliateAdminTabs active="commissions" />

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Affiliate</label>
            <select
              value={affiliateId}
              onChange={(e) => { setAffiliateId(e.target.value); setOffset(0); }}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              <option value="">All affiliates</option>
              {affiliates.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setOffset(0); }}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setOffset(0); }}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            />
          </div>
        </div>
        {(affiliateId || status || from || to) && (
          <div className="mt-3">
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}
      </Card>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      {commissions.length === 0 && !loading ? (
        <EmptyState
          icon={Coins}
          message={affiliateId || status || from || to
            ? "No commissions match the current filters."
            : "No commissions yet. They'll appear here after webhooks record them."}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Lead</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatShortDate(c.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-foreground">{c.affiliateName}</span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-sm text-foreground">
                      {c.leadName ?? "—"}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground capitalize">{c.type}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground whitespace-nowrap">
                      {formatDollars(c.amountCents)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-4 py-3">
                      {renderRowActions(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {commissions.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {pageStart}–{pageEnd} of {total}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={!hasPrev}
              className="px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium text-foreground hover:border-[#ff876d]/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasNext}
              className="px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium text-foreground hover:border-[#ff876d]/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Action Dialog */}
      <Dialog open={dialog.mode !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === "approve" && "Approve commission"}
              {dialog.mode === "reverse" && "Reverse commission"}
              {dialog.mode === "hold" && "Hold commission"}
            </DialogTitle>
            {dialog.commission && (
              <DialogDescription>
                <span className="font-semibold text-foreground">
                  {formatDollars(dialog.commission.amountCents)}
                </span>
                {" from "}
                <span className="font-semibold text-foreground">
                  {dialog.commission.leadName ?? "—"}
                </span>
                {" · "}
                {dialog.commission.affiliateName}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-foreground">
              Reason {dialog.mode === "approve" ? "(optional)" : <span className="text-destructive">*</span>}
            </label>
            <textarea
              value={dialog.reason}
              onChange={(e) => setDialog((d) => ({ ...d, reason: e.target.value }))}
              disabled={dialog.loading}
              rows={3}
              placeholder={
                dialog.mode === "approve"
                  ? "Optional note to include with approval"
                  : "Required — why are you taking this action?"
              }
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
            />
            {dialog.error && (
              <p className="text-xs text-destructive">{dialog.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={dialog.loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDialogSubmit}
              disabled={dialog.loading}
              className={
                dialog.mode === "reverse"
                  ? "bg-red-500 hover:bg-red-500/90 text-white"
                  : dialog.mode === "hold"
                  ? "bg-orange-500 hover:bg-orange-500/90 text-white"
                  : "bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
              }
            >
              {dialog.loading ? "Saving…" :
                dialog.mode === "approve" ? "Approve" :
                dialog.mode === "reverse" ? "Reverse" :
                "Hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
