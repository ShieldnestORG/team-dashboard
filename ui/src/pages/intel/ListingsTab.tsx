import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Mail, Crown, AlertTriangle, DollarSign, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import {
  directoryListingsApi,
  type CompanyListingRow,
} from "../../api/directoryListings";
import { ListingDetailDrawer } from "./ListingDetailDrawer";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "no_listing", label: "Prospects" },
  { value: "contacted", label: "Contacted" },
  { value: "checkout_sent", label: "Checkout sent" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
];

const DIRECTORY_FILTERS = [
  { value: "all", label: "All directories" },
  { value: "blockchain", label: "Crypto" },
  { value: "ai-ml", label: "AI/ML" },
  { value: "defi", label: "DeFi" },
  { value: "devtools", label: "DevTools" },
];

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function statusBadgeVariant(status: string | undefined): {
  variant: "default" | "secondary" | "outline" | "destructive";
  label: string;
} {
  switch (status) {
    case "active":
      return { variant: "default", label: "Active" };
    case "past_due":
      return { variant: "destructive", label: "Past due" };
    case "checkout_sent":
      return { variant: "secondary", label: "Checkout sent" };
    case "contacted":
      return { variant: "secondary", label: "Contacted" };
    case "canceled":
      return { variant: "outline", label: "Canceled" };
    case "expired":
      return { variant: "outline", label: "Expired" };
    default:
      return { variant: "outline", label: "Prospect" };
  }
}

export function ListingsTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directoryFilter, setDirectoryFilter] = useState("all");
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["directory-listings", "stats"],
    queryFn: () => directoryListingsApi.getStats(),
  });

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: [
      "directory-listings",
      "list",
      directoryFilter,
      statusFilter,
      search,
    ],
    queryFn: () =>
      directoryListingsApi.list({
        directory: directoryFilter,
        status: statusFilter,
        search: search || undefined,
        limit: 100,
      }),
  });

  const items: CompanyListingRow[] = listData?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          icon={Crown}
          label="Active"
          value={statsLoading ? "…" : String(stats?.active ?? 0)}
          hint={stats ? `${formatMoney(stats.mrrCents)} MRR` : undefined}
          accent="text-emerald-500"
        />
        <StatCard
          icon={DollarSign}
          label="MRR"
          value={stats ? formatMoney(stats.mrrCents) : "…"}
          hint="Recurring monthly"
        />
        <StatCard
          icon={AlertTriangle}
          label="Past due"
          value={statsLoading ? "…" : String(stats?.pastDue ?? 0)}
          accent={stats && stats.pastDue > 0 ? "text-yellow-500" : undefined}
        />
        <StatCard
          icon={Mail}
          label="With email"
          value={statsLoading ? "…" : String(stats?.withContactEmail ?? 0)}
          hint={stats ? `of ${stats.totalCompanies} total` : undefined}
        />
        <StatCard
          icon={Users}
          label="Total"
          value={statsLoading ? "…" : String(stats?.totalCompanies ?? 0)}
          hint="Companies indexed"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search name, slug, category, email, website…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={directoryFilter}
          onChange={(e) => setDirectoryFilter(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          {DIRECTORY_FILTERS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
              statusFilter === s.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-accent"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {listLoading && <PageSkeleton variant="list" />}
      {!listLoading && items.length === 0 && (
        <EmptyState icon={Search} message="No companies match these filters." />
      )}
      {!listLoading && items.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            {listData?.total ?? items.length} compan
            {(listData?.total ?? items.length) !== 1 ? "ies" : "y"}
          </p>
          <div className="border border-border overflow-x-auto rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium hidden sm:table-cell">
                    Directory
                  </th>
                  <th className="px-3 py-2 font-medium hidden md:table-cell">
                    Contact
                  </th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">
                    Tier
                  </th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">
                    Monthly
                  </th>
                  <th className="px-3 py-2 font-medium hidden xl:table-cell">
                    Renews
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((row) => {
                  const badge = statusBadgeVariant(row.listing?.status);
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-accent/40 cursor-pointer transition-colors"
                      onClick={() => setSelectedCompanyId(row.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.category}
                        </div>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <Badge variant="outline">{row.directory}</Badge>
                      </td>
                      <td className="px-3 py-2 hidden md:table-cell text-xs">
                        {row.contactEmail ? (
                          <span className="text-foreground">{row.contactEmail}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="px-3 py-2 hidden lg:table-cell text-xs capitalize">
                        {row.listing?.tier ?? "—"}
                      </td>
                      <td className="px-3 py-2 hidden lg:table-cell tabular-nums text-xs">
                        {row.listing
                          ? formatMoney(row.listing.monthlyPriceCents)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 hidden xl:table-cell text-xs text-muted-foreground">
                        {row.listing?.currentPeriodEnd
                          ? new Date(row.listing.currentPeriodEnd).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedCompanyId !== null && (
        <ListingDetailDrawer
          companyId={selectedCompanyId}
          onClose={() => setSelectedCompanyId(null)}
        />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Crown;
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className={`h-4 w-4 ${accent ?? ""}`} />
          <CardTitle className="text-xs font-medium">{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className={`text-xl font-bold tabular-nums ${accent ?? ""}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}
