import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Undo2 } from "lucide-react";
import {
  affiliatesAdminApi,
  type AdminAffiliate,
  type AdminClawback,
  type ListClawbacksAdminFilters,
} from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-red-500/15 text-red-500 border-red-500/30" },
  recovering: { label: "Recovering", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  recovered: { label: "Recovered", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  written_off: { label: "Written Off", className: "bg-muted text-muted-foreground border-border" },
};

const REASON_LABELS: Record<string, string> = {
  stripe_refund: "Stripe refund",
  compliance_violation: "Compliance",
  admin_manual: "Manual",
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
  { value: "open", label: "Open" },
  { value: "recovering", label: "Recovering" },
  { value: "recovered", label: "Recovered" },
  { value: "written_off", label: "Written Off" },
];

export function AffiliateAdminClawbacks() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [affiliates, setAffiliates] = useState<AdminAffiliate[]>([]);
  const [clawbacks, setClawbacks] = useState<AdminClawback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [affiliateId, setAffiliateId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Clawbacks" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    affiliatesAdminApi.list()
      .then((res) => setAffiliates(res.affiliates))
      .catch(() => { /* affiliate dropdown is optional */ });
  }, []);

  const filters = useMemo<ListClawbacksAdminFilters>(() => ({
    affiliateId: affiliateId || undefined,
    status: status || undefined,
  }), [affiliateId, status]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    affiliatesAdminApi.listClawbacks(filters)
      .then((res) => setClawbacks(res.clawbacks))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load clawbacks"))
      .finally(() => setLoading(false));
  }, [filters]);

  const outstandingCents = useMemo(
    () => clawbacks
      .filter((c) => c.status === "open" || c.status === "recovering")
      .reduce((sum, c) => sum + c.remainingCents, 0),
    [clawbacks],
  );

  if (loading && clawbacks.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Clawbacks</h1>
        <p className="text-sm text-muted-foreground">
          Recovery obligations from already-disbursed commissions, netted against future payouts.
        </p>
      </div>

      <AffiliateAdminTabs active="clawbacks" />

      {/* Filters + summary */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Affiliate</label>
            <select
              value={affiliateId}
              onChange={(e) => setAffiliateId(e.target.value)}
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
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end">
            <span className="block text-[11px] font-medium text-muted-foreground mb-1">Outstanding (shown)</span>
            <span className="text-sm font-semibold text-foreground">{formatDollars(outstandingCents)}</span>
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {clawbacks.length === 0 && !loading ? (
        <EmptyState
          icon={Undo2}
          message={affiliateId || status
            ? "No clawbacks match the current filters."
            : "No clawbacks yet. They appear here when a disbursed commission is refunded or clawed back."}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Lead</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Reason</th>
                  <th className="px-4 py-3 font-medium text-right">Origin</th>
                  <th className="px-4 py-3 font-medium text-right">Recovered</th>
                  <th className="px-4 py-3 font-medium text-right">Remaining</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell whitespace-nowrap">Window ends</th>
                </tr>
              </thead>
              <tbody>
                {clawbacks.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatShortDate(c.createdAt)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{c.affiliateName ?? "—"}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-sm text-foreground">{c.leadName ?? "—"}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                      {REASON_LABELS[c.reason] ?? c.reason}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground whitespace-nowrap">{formatDollars(c.originAmountCents)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">{formatDollars(c.recoveredCents)}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground whitespace-nowrap">{formatDollars(c.remainingCents)}</td>
                    <td className="px-4 py-3"><StatusPill status={c.status} /></td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                      {formatShortDate(c.windowExpiresAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
