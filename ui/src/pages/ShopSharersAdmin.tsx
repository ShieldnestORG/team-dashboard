import { useEffect, useMemo, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Users } from "lucide-react";
import {
  shopSharersApi,
  type ShopSharer,
  type ShopSharerApproveResult,
} from "@/api/shop-sharers";

// ---------------------------------------------------------------------------
// Shop Sharers Admin — approve / reject applications from the shop email
// capture → QR + referral link flow. See docs/products/shop-sharers.md.
// ---------------------------------------------------------------------------

type FilterKey = "pending" | "approved" | "rejected" | "all";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: string | null): { label: string; cls: string } {
  if (status === "pending") {
    return {
      label: "Pending",
      cls: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    };
  }
  if (status === "approved") {
    return {
      label: "Approved",
      cls: "bg-green-500/15 text-green-600 border-green-500/30",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rejected",
      cls: "bg-red-500/15 text-red-600 border-red-500/30",
    };
  }
  return {
    label: "Sharer only",
    cls: "bg-muted text-muted-foreground border-border",
  };
}

export function ShopSharersAdmin() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [rows, setRows] = useState<ShopSharer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [lastApproval, setLastApproval] = useState<
    ShopSharerApproveResult | null
  >(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Shop Sharers" }]);
  }, [setBreadcrumbs]);

  async function refresh() {
    const status = filter === "all" ? undefined : filter;
    const res = await shopSharersApi.list(status);
    setRows(res.sharers);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load sharers"),
      )
      .finally(() => setLoading(false));
  }, [filter]);

  async function handleApprove(row: ShopSharer) {
    if (!confirm(`Approve ${row.email} as an affiliate?`)) return;
    setBusyId(row.id);
    try {
      const result = await shopSharersApi.approve(row.id);
      setLastApproval(result);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(row: ShopSharer) {
    const notes = window.prompt(`Reject ${row.email}? Optional notes:`, "");
    if (notes === null) return;
    setBusyId(row.id);
    try {
      await shopSharersApi.reject(row.id, notes || undefined);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, total: rows.length };
    for (const r of rows) {
      if (r.affiliateApplicationStatus === "pending") c.pending += 1;
      else if (r.affiliateApplicationStatus === "approved") c.approved += 1;
      else if (r.affiliateApplicationStatus === "rejected") c.rejected += 1;
    }
    return c;
  }, [rows]);

  if (loading && rows.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Shop Sharers</h1>
        <p className="text-sm text-muted-foreground">
          Email signups from <code className="text-xs">shop.coherencedaddy.com</code>.
          Approving a pending application creates an active affiliate row with
          shared-marketing eligibility.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === "pending" && counts.pending > 0 && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-700">
                {counts.pending}
              </span>
            )}
          </Button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {lastApproval && (
        <Card className="p-4 bg-green-500/5 border-green-500/30">
          <div className="text-sm font-medium">
            Approved {lastApproval.affiliate.email}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Send them this one-time password-set token (valid 14 days):
          </div>
          <code className="mt-2 block text-xs bg-background border border-border rounded p-2 font-mono break-all">
            {lastApproval.resetToken}
          </code>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setLastApproval(null)}
          >
            Dismiss
          </Button>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Users} message="No sharers in this view yet." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">
                    Source
                  </th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">
                    Signed up
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const busy = busyId === row.id;
                  const badge = statusBadge(row.affiliateApplicationStatus);
                  return (
                    <tr
                      key={row.id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        {row.email}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {row.referralCode}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                        {row.source}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {row.affiliateApplicationStatus === "pending" && (
                            <>
                              <Button
                                size="sm"
                                className="text-xs h-7 bg-[#ff876d] hover:bg-[#ff876d]/90 text-white"
                                onClick={() => handleApprove(row)}
                                disabled={busy}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 text-destructive"
                                onClick={() => handleReject(row)}
                                disabled={busy}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {row.affiliateApplicationStatus === null && (
                            <span className="text-xs text-muted-foreground">
                              No application
                            </span>
                          )}
                          {row.affiliateApplicationStatus === "approved" && (
                            <span className="text-xs text-muted-foreground">
                              Affiliate #{row.affiliateId?.slice(0, 8)}
                            </span>
                          )}
                          {row.affiliateApplicationStatus === "rejected" &&
                            row.notes && (
                              <span
                                className="text-xs text-muted-foreground truncate max-w-[220px]"
                                title={row.notes}
                              >
                                {row.notes}
                              </span>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
