import { useEffect, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { UsersRound } from "lucide-react";
import { affiliatesAdminApi, type AdminAffiliate } from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

function statusBadgeClass(status: string): string {
  if (status === "active") return "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-600 border border-green-500/30";
  if (status === "pending") return "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-600 border border-amber-500/30";
  if (status === "suspended") return "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-600 border border-red-500/30";
  return "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border";
}

export function AffiliatesAdmin() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [affiliates, setAffiliates] = useState<AdminAffiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    affiliatesAdminApi.list()
      .then((res) => setAffiliates(res.affiliates))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleStatusChange(id: string, newStatus: "active" | "suspended" | "pending") {
    setActionLoading(id);
    try {
      await affiliatesAdminApi.updateStatus(id, newStatus);
      setAffiliates((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <PageSkeleton variant="list" />;

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const total = affiliates.length;
  const pending = affiliates.filter((a) => a.status === "pending").length;
  const active = affiliates.filter((a) => a.status === "active").length;
  const suspended = affiliates.filter((a) => a.status === "suspended").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Affiliates</h1>
        <p className="text-sm text-muted-foreground">Manage affiliate marketer accounts</p>
      </div>

      <AffiliateAdminTabs active="affiliates" />

      {/* Summary stats */}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{total}</span> total
        {" · "}
        <span className="font-medium text-amber-600">{pending}</span> pending
        {" · "}
        <span className="font-medium text-green-600">{active}</span> active
        {" · "}
        <span className="font-medium text-red-600">{suspended}</span> suspended
      </p>

      {/* Table */}
      {affiliates.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          message="No affiliates yet. Share affiliates.coherencedaddy.com to start growing your network."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Email</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Commission</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell text-right">Prospects</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell text-right">Converted</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Applied</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">{a.name}</span>
                      <span className="block text-xs text-muted-foreground sm:hidden">{a.email}</span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs text-muted-foreground">{a.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClass(a.status)}>{a.status}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs font-medium">
                        {(parseFloat(a.commissionRate) * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-right">
                      <span className="text-xs font-medium">{a.prospectCount}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-right">
                      <span className={`text-xs font-medium ${a.convertedCount > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        {a.convertedCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {a.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 border-green-500/40 text-green-700 hover:bg-green-500/10 hover:text-green-800"
                          disabled={actionLoading === a.id}
                          onClick={() => handleStatusChange(a.id, "active")}
                        >
                          {actionLoading === a.id ? "Saving..." : "Approve"}
                        </Button>
                      )}
                      {a.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 text-muted-foreground"
                          disabled={actionLoading === a.id}
                          onClick={() => handleStatusChange(a.id, "suspended")}
                        >
                          {actionLoading === a.id ? "Saving..." : "Suspend"}
                        </Button>
                      )}
                      {a.status === "suspended" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 border-green-500/40 text-green-700 hover:bg-green-500/10 hover:text-green-800"
                          disabled={actionLoading === a.id}
                          onClick={() => handleStatusChange(a.id, "active")}
                        >
                          {actionLoading === a.id ? "Saving..." : "Reinstate"}
                        </Button>
                      )}
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
