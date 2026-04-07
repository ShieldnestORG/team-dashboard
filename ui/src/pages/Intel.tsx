import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useLocation } from "@/lib/router";
import { intelApi, type IntelCompany, type IntelStats } from "../api/intel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { PageTabBar } from "../components/PageTabBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Database, Search, Building2, BarChart3, Clock } from "lucide-react";
import { HowToGuide } from "../components/HowToGuide";

type DirectoryTab = "overview" | "crypto" | "ai-ml" | "defi" | "devtools";

const TAB_ITEMS: { value: DirectoryTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "crypto", label: "Crypto" },
  { value: "ai-ml", label: "AI/ML" },
  { value: "defi", label: "DeFi" },
  { value: "devtools", label: "DevTools" },
];

const DIRECTORY_MAP: Record<string, string> = {
  crypto: "blockchain",
  "ai-ml": "ai-ml",
  defi: "defi",
  devtools: "devtools",
};

function relativeTimeShort(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Intel() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();

  const pathSegment = location.pathname.split("/").pop() ?? "overview";
  const tab: DirectoryTab = TAB_ITEMS.some((t) => t.value === pathSegment)
    ? (pathSegment as DirectoryTab)
    : "overview";

  const [search, setSearch] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Intel" }]);
  }, [setBreadcrumbs]);

  const directoryParam = tab !== "overview" ? DIRECTORY_MAP[tab] : undefined;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: queryKeys.intel.stats,
    queryFn: () => intelApi.getStats(),
  });

  const { data: companies, isLoading: companiesLoading } = useQuery({
    queryKey: queryKeys.intel.companies(directoryParam),
    queryFn: () => intelApi.listCompanies(directoryParam),
    enabled: tab !== "overview",
  });

  const filtered = useMemo(() => {
    if (!companies) return [];
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q),
    );
  }, [companies, search]);

  if (statsLoading && tab === "overview") {
    return <PageSkeleton variant="dashboard" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => navigate(v === "overview" ? "/intel" : `/intel/${v}`)}>
          <PageTabBar
            items={TAB_ITEMS}
            value={tab}
            onValueChange={(v) => navigate(v === "overview" ? "/intel" : `/intel/${v}`)}
          />
        </Tabs>
      </div>

      <HowToGuide
        sections={[
          {
            heading: "What This Page Shows",
            steps: [
              { title: "508+ blockchain companies", description: "Across 4 directories — Crypto, AI/ML, DeFi, and DevTools. Each company has auto-collected data." },
              { title: "Data is collected automatically", description: "Cron jobs pull price data, news, GitHub activity, Twitter mentions, and Reddit posts every 30 min to 4 hours." },
              { title: "Powers the public directory", description: "This data feeds coherencedaddy.com/directory — the public-facing blockchain project directory." },
            ],
          },
          {
            heading: "Browsing Companies",
            steps: [
              { title: "Pick a directory tab", description: "Click Crypto, AI/ML, DeFi, or DevTools to browse that category." },
              { title: "Search", description: "Use the search bar to find a specific company by name." },
              { title: "Overview tab", description: "See total counts and high-level stats across all directories." },
            ],
          },
          {
            heading: "Behind the Scenes",
            steps: [
              { title: "Intel Discovery", description: "New trending projects are auto-discovered from CoinGecko and GitHub trending. High-confidence finds are added automatically." },
              { title: "Backfill", description: "Newly added companies get historical data backfilled automatically so they don't start empty." },
              { title: "Vector embeddings", description: "All intel reports are embedded with BGE-M3 for semantic search — agents use this for context when generating content." },
            ],
          },
        ]}
      />

      {tab === "overview" && <OverviewPanel stats={stats ?? null} />}

      {tab !== "overview" && (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {companiesLoading && <PageSkeleton variant="list" />}

          {!companiesLoading && filtered.length === 0 && (
            <EmptyState icon={Database} message="No companies found." />
          )}

          {!companiesLoading && filtered.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {filtered.length} compan{filtered.length !== 1 ? "ies" : "y"}
                {search.trim() && companies ? ` of ${companies.length}` : ""}
              </p>
              <CompanyTable companies={filtered} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function OverviewPanel({ stats }: { stats: IntelStats | null }) {
  const directories = stats?.directories ?? {};
  const directoryEntries = Object.entries(directories);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label="Total Companies"
          value={stats?.totalCompanies ?? 0}
        />
        <StatCard
          icon={BarChart3}
          label="Total Reports"
          value={stats?.totalReports ?? 0}
        />
        <StatCard
          icon={Database}
          label="Directories"
          value={directoryEntries.length}
        />
        <StatCard
          icon={Clock}
          label="Last Ingestion"
          value={stats?.lastIngestion ? relativeTimeShort(stats.lastIngestion) : "N/A"}
          isText
        />
      </div>

      {directoryEntries.length > 0 && (
        <div className="border border-border">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">Directory Breakdown</h3>
          </div>
          <div className="divide-y divide-border">
            {directoryEntries.map(([dir, count]) => (
              <div key={dir} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{dir}</span>
                <Badge variant="secondary">{String(count)}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  isText = false,
}: {
  icon: typeof Building2;
  label: string;
  value: number | string;
  isText?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className={isText ? "text-lg font-semibold" : "text-2xl font-bold tabular-nums"}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      </CardContent>
    </Card>
  );
}

function CompanyTable({ companies }: { companies: IntelCompany[] }) {
  return (
    <div className="border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">Category</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground hidden sm:table-cell">Directory</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground hidden md:table-cell">Data Sources</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground hidden lg:table-cell">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {companies.map((company) => (
            <tr key={company.slug} className="hover:bg-accent/30 transition-colors">
              <td className="px-4 py-2 font-medium">{company.name}</td>
              <td className="px-4 py-2 text-muted-foreground">{company.category}</td>
              <td className="px-4 py-2 hidden sm:table-cell">
                <Badge variant="outline">{company.directory}</Badge>
              </td>
              <td className="px-4 py-2 hidden md:table-cell">
                <div className="flex flex-wrap gap-1">
                  {(company.dataSources ?? []).map((src) => (
                    <Badge key={src} variant="secondary" className="text-[10px]">
                      {src}
                    </Badge>
                  ))}
                  {(!company.dataSources || company.dataSources.length === 0) && (
                    <span className="text-muted-foreground text-xs">--</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground text-xs hidden lg:table-cell">
                {company.lastUpdated ? relativeTimeShort(company.lastUpdated) : "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
