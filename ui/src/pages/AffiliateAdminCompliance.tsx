import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { ShieldAlert } from "lucide-react";
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
  type AdminViolation,
  type ListViolationsFilters,
} from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const SEVERITY_PILL: Record<string, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-muted text-muted-foreground border-border" },
  medium: { label: "Medium", className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" },
  high: { label: "High", className: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
  critical: { label: "Critical", className: "bg-red-500/15 text-red-600 border-red-500/30" },
};

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-red-500/15 text-red-600 border-red-500/30" },
  acknowledged: { label: "Acknowledged", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  overturned: { label: "Overturned", className: "bg-muted text-muted-foreground border-border" },
  enforced: { label: "Enforced", className: "bg-green-500/15 text-green-600 border-green-500/30" },
};

function SeverityPill({ severity }: { severity: string }) {
  const cfg = SEVERITY_PILL[severity] ?? { label: severity, className: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL[status] ?? { label: status, className: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

const SEVERITY_OPTIONS = [
  { value: "", label: "All severities" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "overturned", label: "Overturned" },
  { value: "enforced", label: "Enforced" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ActionMode = "acknowledged" | "overturned" | "enforced" | null;

interface DetailPanelState {
  open: boolean;
  violation: AdminViolation | null;
  actionMode: ActionMode;
  clawback: boolean;
  loading: boolean;
  error: string | null;
}

interface SuspendDialogState {
  open: boolean;
  violation: AdminViolation | null;
  reason: string;
  loading: boolean;
  error: string | null;
}

export function AffiliateAdminCompliance() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [violations, setViolations] = useState<AdminViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [severity, setSeverity] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const [panel, setPanel] = useState<DetailPanelState>({
    open: false,
    violation: null,
    actionMode: null,
    clawback: false,
    loading: false,
    error: null,
  });

  const [suspend, setSuspend] = useState<SuspendDialogState>({
    open: false,
    violation: null,
    reason: "",
    loading: false,
    error: null,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Compliance" }]);
  }, [setBreadcrumbs]);

  const filters = useMemo<ListViolationsFilters>(() => ({
    severity: severity || undefined,
    status: status || undefined,
  }), [severity, status]);

  async function refresh() {
    const res = await affiliatesAdminApi.listViolations(filters);
    setViolations(res);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    affiliatesAdminApi.listViolations(filters)
      .then((res) => setViolations(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load violations"))
      .finally(() => setLoading(false));
  }, [filters]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return violations;
    return violations.filter((v) =>
      v.affiliateName.toLowerCase().includes(q) ||
      v.affiliateEmail.toLowerCase().includes(q),
    );
  }, [violations, search]);

  function openPanel(v: AdminViolation) {
    setPanel({
      open: true,
      violation: v,
      actionMode: null,
      clawback: false,
      loading: false,
      error: null,
    });
  }

  function closePanel() {
    if (panel.loading) return;
    setPanel({ open: false, violation: null, actionMode: null, clawback: false, loading: false, error: null });
  }

  async function handleStatusAction() {
    if (!panel.violation || !panel.actionMode) return;
    setPanel((p) => ({ ...p, loading: true, error: null }));
    try {
      const commissionAction =
        panel.actionMode === "enforced" && panel.clawback ? "clawback" : undefined;
      await affiliatesAdminApi.updateViolationStatus(
        panel.violation.id,
        panel.actionMode,
        commissionAction,
      );
      await refresh();
      closePanel();
    } catch (err) {
      setPanel((p) => ({
        ...p,
        loading: false,
        error: err instanceof Error ? err.message : "Action failed",
      }));
    }
  }

  function openSuspend(v: AdminViolation) {
    setSuspend({
      open: true,
      violation: v,
      reason: "",
      loading: false,
      error: null,
    });
  }

  function closeSuspend() {
    if (suspend.loading) return;
    setSuspend({ open: false, violation: null, reason: "", loading: false, error: null });
  }

  async function handleSuspendSubmit() {
    if (!suspend.violation) return;
    const trimmed = suspend.reason.trim();
    if (trimmed.length < 3) {
      setSuspend((s) => ({ ...s, error: "Reason is required (min 3 characters)" }));
      return;
    }
    setSuspend((s) => ({ ...s, loading: true, error: null }));
    try {
      await affiliatesAdminApi.suspendAffiliate(suspend.violation.affiliateId, trimmed);
      await refresh();
      closeSuspend();
      closePanel();
    } catch (err) {
      setSuspend((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to suspend",
      }));
    }
  }

  if (loading && violations.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Compliance</h1>
        <p className="text-sm text-muted-foreground">
          Review misrepresentation flags and take enforcement action on violating affiliates.
        </p>
      </div>

      <AffiliateAdminTabs active="compliance" />

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              {SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Affiliate search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            />
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {filtered.length === 0 && !loading ? (
        <EmptyState
          icon={ShieldAlert}
          message={severity || status || search
            ? "No violations match the current filters."
            : "No compliance violations yet."}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Rule</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell text-right">Clawed Back</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => openPanel(v)}
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatShortDate(v.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{v.affiliateName}</p>
                      <p className="text-xs text-muted-foreground">{v.affiliateEmail}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                      <span className="font-mono">{v.ruleCode}</span>
                    </td>
                    <td className="px-4 py-3">
                      <SeverityPill severity={v.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={v.status} />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-right text-xs text-muted-foreground">
                      {v.commissionsClawedBack > 0 ? `${v.commissionsClawedBack}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Violation Detail Dialog */}
      <Dialog open={panel.open} onOpenChange={(open) => { if (!open) closePanel(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Violation detail</DialogTitle>
            {panel.violation && (
              <DialogDescription>
                <span className="font-semibold text-foreground">{panel.violation.affiliateName}</span>
                {" · "}
                <span className="font-mono text-xs">{panel.violation.ruleCode}</span>
                {" · "}
                {formatShortDate(panel.violation.createdAt)}
              </DialogDescription>
            )}
          </DialogHeader>

          {panel.violation && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <SeverityPill severity={panel.violation.severity} />
                <StatusPill status={panel.violation.status} />
                <span className="text-xs text-muted-foreground">
                  Detection: {panel.violation.detectionType}
                </span>
              </div>

              {panel.violation.leadName && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Related lead</p>
                  <p className="text-sm text-foreground">{panel.violation.leadName}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Evidence source</p>
                <p className="text-sm text-foreground">{panel.violation.evidence.source}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Excerpt</p>
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {panel.violation.evidence.excerpt}
                  </p>
                </div>
              </div>

              {panel.violation.evidence.matchedPattern && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Matched pattern</p>
                  <p className="font-mono text-xs text-foreground bg-muted/40 rounded px-2 py-1 inline-block">
                    {panel.violation.evidence.matchedPattern}
                  </p>
                </div>
              )}

              {panel.violation.commissionsClawedBack > 0 && (
                <p className="text-xs text-muted-foreground">
                  {panel.violation.commissionsClawedBack} commissions already clawed back.
                </p>
              )}

              {/* Action selector */}
              <div className="pt-2 border-t border-border space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Take action</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={panel.actionMode === "acknowledged" ? "default" : "outline"}
                    className={
                      panel.actionMode === "acknowledged"
                        ? "text-xs h-7 bg-blue-500 hover:bg-blue-500/90 text-white"
                        : "text-xs h-7 border-blue-500/40 text-blue-600 hover:bg-blue-500/10"
                    }
                    onClick={() => setPanel((p) => ({ ...p, actionMode: "acknowledged", clawback: false }))}
                    disabled={panel.loading}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={panel.actionMode === "overturned" ? "default" : "outline"}
                    className={
                      panel.actionMode === "overturned"
                        ? "text-xs h-7 bg-muted-foreground hover:bg-muted-foreground/90 text-white"
                        : "text-xs h-7 border-border text-muted-foreground hover:bg-muted"
                    }
                    onClick={() => setPanel((p) => ({ ...p, actionMode: "overturned", clawback: false }))}
                    disabled={panel.loading}
                  >
                    Overturn
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={panel.actionMode === "enforced" ? "default" : "outline"}
                    className={
                      panel.actionMode === "enforced"
                        ? "text-xs h-7 bg-red-500 hover:bg-red-500/90 text-white"
                        : "text-xs h-7 border-red-500/40 text-red-600 hover:bg-red-500/10"
                    }
                    onClick={() => setPanel((p) => ({ ...p, actionMode: "enforced" }))}
                    disabled={panel.loading}
                  >
                    Enforce
                  </Button>
                </div>

                {panel.actionMode === "enforced" && (
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={panel.clawback}
                      onChange={(e) => setPanel((p) => ({ ...p, clawback: e.target.checked }))}
                      disabled={panel.loading}
                      className="rounded border-border"
                    />
                    Also clawback commissions tied to this affiliate
                  </label>
                )}

                {panel.error && (
                  <p className="text-xs text-destructive">{panel.error}</p>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => panel.violation && openSuspend(panel.violation)}
              disabled={panel.loading || !panel.violation}
              className="text-xs border-red-500/40 text-red-600 hover:bg-red-500/10"
            >
              Suspend Affiliate
            </Button>
            <div className="flex items-center gap-2 justify-end">
              <Button type="button" variant="outline" onClick={closePanel} disabled={panel.loading}>
                Close
              </Button>
              <Button
                type="button"
                onClick={handleStatusAction}
                disabled={panel.loading || panel.actionMode === null}
                className="bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
              >
                {panel.loading ? "Saving…" : "Apply"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Affiliate Dialog */}
      <Dialog open={suspend.open} onOpenChange={(open) => { if (!open) closeSuspend(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend affiliate</DialogTitle>
            {suspend.violation && (
              <DialogDescription>
                Suspending <span className="font-semibold text-foreground">{suspend.violation.affiliateName}</span>{" "}
                will block new submissions and hold existing payouts.
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-foreground">
              Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              value={suspend.reason}
              onChange={(e) => setSuspend((s) => ({ ...s, reason: e.target.value }))}
              disabled={suspend.loading}
              rows={3}
              placeholder="Explain why you're suspending this affiliate"
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
            />
            {suspend.error && (
              <p className="text-xs text-destructive">{suspend.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeSuspend} disabled={suspend.loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSuspendSubmit}
              disabled={suspend.loading}
              className="bg-red-500 hover:bg-red-500/90 text-white"
            >
              {suspend.loading ? "Saving…" : "Confirm Suspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
