import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  Inbox as InboxIcon,
  Link2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "../components/PageSkeleton";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import {
  creditscoreLeadsApi,
  type CreditScoreReportLead,
  type CreditScoreReportStatus,
  type CreditScoreSubscriptionTier,
} from "../api/creditscoreLeads";

const PAGE_SIZE = 50;

type DateRange = "7d" | "30d" | "90d" | "all";

const STATUS_OPTIONS: { value: "" | CreditScoreReportStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "complete", label: "Complete" },
  { value: "failed", label: "Failed" },
];

const TIER_OPTIONS: { value: "" | CreditScoreSubscriptionTier; label: string }[] = [
  { value: "", label: "All tiers" },
  { value: "report", label: "Report (one-time)" },
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "pro", label: "Pro" },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateRangeToISO(range: DateRange): string | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    {
      pending: "bg-yellow-500/20 text-yellow-500",
      complete: "bg-green-500/20 text-green-500",
      failed: "bg-red-500/20 text-red-500",
    }[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", tone)}>
      {status}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) {
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
        free
      </span>
    );
  }
  const tone =
    {
      report: "bg-zinc-500/20 text-zinc-400",
      starter: "bg-blue-500/20 text-blue-500",
      growth: "bg-purple-500/20 text-purple-500",
      pro: "bg-amber-500/20 text-amber-500",
    }[tier] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", tone)}>
      {tier}
    </span>
  );
}

function ScoreCell({
  score,
  previousScore,
}: {
  score: number | null;
  previousScore: number | null;
}) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const delta = previousScore != null ? score - previousScore : null;
  return (
    <div className="flex items-baseline gap-1">
      <span className="font-semibold tabular-nums">{score}</span>
      {delta != null && delta !== 0 && (
        <span
          className={cn(
            "text-[10px] tabular-nums",
            delta > 0 ? "text-green-500" : "text-red-500",
          )}
        >
          {delta > 0 ? "+" : ""}
          {delta}
        </span>
      )}
    </div>
  );
}

function ActionsCell({ row }: { row: CreditScoreReportLead }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        asChild
        className="h-7 px-2 text-xs"
        title="View report"
      >
        <a
          href={`/api/creditscore/report/${row.id}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Button>
      {row.email && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          title={copied ? "Copied" : "Copy email"}
          onClick={() => {
            if (!row.email) return;
            void navigator.clipboard.writeText(row.email).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
      {row.shareableSlug && (
        <Button
          size="sm"
          variant="ghost"
          asChild
          className="h-7 px-2 text-xs"
          title="Open share link"
        >
          <a
            href={`/creditscore/r/${row.shareableSlug}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Link2 className="h-3.5 w-3.5" />
          </a>
        </Button>
      )}
    </div>
  );
}

export function CreditScoreLeadsTab() {
  // Filter state
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [status, setStatus] = useState<"" | CreditScoreReportStatus>("");
  const [tier, setTier] = useState<"" | CreditScoreSubscriptionTier>("");
  const [hasEmail, setHasEmail] = useState(false);
  const [paidOnly, setPaidOnly] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [offset, setOffset] = useState(0);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, status, tier, hasEmail, paidOnly, dateRange]);

  const since = useMemo(() => dateRangeToISO(dateRange), [dateRange]);

  const filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      status: status || undefined,
      tier: tier || undefined,
      hasEmail: hasEmail || undefined,
      hasSubscription: paidOnly || undefined,
      since,
      limit: PAGE_SIZE,
      offset,
    }),
    [debouncedSearch, status, tier, hasEmail, paidOnly, since, offset],
  );

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: queryKeys.creditscoreReview.leads(filters),
    queryFn: () => creditscoreLeadsApi.listReports(filters),
  });

  const reports = data?.reports ?? [];
  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + reports.length, total);
  const hasNext = offset + reports.length < total;
  const hasPrev = offset > 0;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Search domain or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "" | CreditScoreReportStatus)
              }
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={tier}
              onChange={(e) =>
                setTier(e.target.value as "" | CreditScoreSubscriptionTier)
              }
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={hasEmail}
                onChange={(e) => setHasEmail(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Has email only
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={paidOnly}
                onChange={(e) => setPaidOnly(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Paid only
            </label>
            <div className="ml-auto flex items-center gap-1">
              {(["7d", "30d", "90d", "all"] as DateRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDateRange(r)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-medium uppercase transition-colors",
                    dateRange === r
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent",
                  )}
                >
                  {r === "all" ? "All time" : `Last ${r}`}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <PageSkeleton />
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load leads"}
        </p>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <InboxIcon className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No reports match these filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Domain</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Score</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Tier</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {fmtDate(r.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.domain}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.email ?? (
                        <span className="text-muted-foreground italic">anonymous</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ScoreCell score={r.score} previousScore={r.previousScore} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge tier={r.subscriptionTier ?? null} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ActionsCell row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          {total > 0 ? (
            <>
              Showing <Badge variant="secondary">{start}</Badge>–
              <Badge variant="secondary">{end}</Badge> of{" "}
              <Badge variant="secondary">{total}</Badge>
              {isFetching && <span className="ml-2 italic">refreshing…</span>}
            </>
          ) : (
            <span>No results</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!hasPrev}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hasNext}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
