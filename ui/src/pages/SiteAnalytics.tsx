import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Eye,
  Users,
  MousePointerClick,
  DollarSign,
  Wrench,
} from "lucide-react";
import { siteMetricsApi } from "../api/site-metrics";
import type { EmailFeedbackSrc, SiteMetricEntry } from "../api/site-metrics";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Card } from "../components/ui/card";
import { formatCents, formatDate } from "../lib/utils";

const SITE_ID = "coherencedaddy.com";
const LIMIT = 120;

function pctPositive(up: number, down: number): number {
  const denom = up + down;
  if (denom === 0) return 0;
  return Math.round((up / denom) * 100);
}

interface EmailFeedbackTotals {
  total: number;
  up: number;
  down: number;
  comments: number;
  bySrc: EmailFeedbackSrc[];
}

/** Sum emailFeedback across every snapshot (each snapshot is that day's delta). */
function sumEmailFeedback(entries: SiteMetricEntry[]): EmailFeedbackTotals {
  const totals: EmailFeedbackTotals = { total: 0, up: 0, down: 0, comments: 0, bySrc: [] };
  const bySrc = new Map<string, EmailFeedbackSrc>();

  for (const entry of entries) {
    const fb = entry.metrics.emailFeedback;
    if (!fb) continue;
    totals.total += fb.total ?? 0;
    totals.up += fb.up ?? 0;
    totals.down += fb.down ?? 0;
    totals.comments += fb.comments ?? 0;

    for (const row of fb.bySrc ?? []) {
      const existing = bySrc.get(row.src);
      if (existing) {
        existing.up += row.up ?? 0;
        existing.down += row.down ?? 0;
        existing.comments += row.comments ?? 0;
        existing.total += row.total ?? 0;
      } else {
        bySrc.set(row.src, {
          src: row.src,
          up: row.up ?? 0,
          down: row.down ?? 0,
          comments: row.comments ?? 0,
          total: row.total ?? 0,
        });
      }
    }
  }

  totals.bySrc = [...bySrc.values()].sort((a, b) => b.total - a.total);
  return totals;
}

export function SiteAnalytics() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Site Analytics" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.siteMetrics(selectedCompanyId!, { siteId: SITE_ID, limit: LIMIT }),
    queryFn: () => siteMetricsApi.list(selectedCompanyId!, { siteId: SITE_ID, limit: LIMIT }),
    enabled: !!selectedCompanyId,
  });

  // Snapshots are returned newest-first.
  const entries = useMemo(() => data?.metrics ?? [], [data]);
  const feedback = useMemo(() => sumEmailFeedback(entries), [entries]);

  // Recent days with feedback activity, newest first.
  const recentDays = useMemo(
    () =>
      entries
        .filter((e) => e.metrics.emailFeedback)
        .slice(0, 14)
        .map((e) => ({
          receivedAt: e.receivedAt,
          up: e.metrics.emailFeedback!.up ?? 0,
          down: e.metrics.emailFeedback!.down ?? 0,
          comments: e.metrics.emailFeedback!.comments ?? 0,
        })),
    [entries],
  );

  const latest = entries[0];

  const topTools = useMemo(() => {
    const tv = latest?.metrics.toolViews ?? [];
    return [...tv].sort((a, b) => b.views - a.views).slice(0, 8);
  }, [latest]);

  const productRevenue = latest?.metrics.productRevenue ?? [];
  const grossCents = useMemo(
    () => productRevenue.reduce((sum, r) => sum + (r.gross_cents ?? 0), 0),
    [productRevenue],
  );
  const netCents = useMemo(
    () => productRevenue.reduce((sum, r) => sum + (r.net_cents ?? 0), 0),
    [productRevenue],
  );

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={BarChart3}
        message={
          companies.length === 0
            ? "Set up a company to view site analytics."
            : "Create or select a company to view site analytics."
        }
      />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-6">
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        <EmptyState icon={BarChart3} message="No site metrics yet." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* ------------------------------------------------------------------ */}
      {/* Email feedback — the star of the page                              */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Email feedback
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Cumulative across the last {entries.length} daily snapshot
            {entries.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
          <MetricCard
            icon={ThumbsUp}
            value={feedback.up}
            label="Thumbs up"
            description={<span>{feedback.total} total responses</span>}
          />
          <MetricCard
            icon={ThumbsDown}
            value={feedback.down}
            label="Thumbs down"
          />
          <MetricCard
            icon={MessageSquare}
            value={feedback.comments}
            label="Written comments"
          />
          <MetricCard
            icon={BarChart3}
            value={`${pctPositive(feedback.up, feedback.down)}%`}
            label="Positive"
            description={<span>of rated responses</span>}
          />
        </div>

        {/* Per-email-type table */}
        {feedback.bySrc.length > 0 && (
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Email type</th>
                    <th className="px-4 py-2.5 font-medium text-right">👍</th>
                    <th className="px-4 py-2.5 font-medium text-right">👎</th>
                    <th className="px-4 py-2.5 font-medium text-right">💬</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total</th>
                    <th className="px-4 py-2.5 font-medium text-right">Positive</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {feedback.bySrc.map((row) => (
                    <tr key={row.src} className="hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{row.src}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.up}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.down}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.comments}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.total}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {pctPositive(row.up, row.down)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Recent days */}
        {recentDays.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Recent days
            </h3>
            <Card className="gap-0 py-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Date</th>
                      <th className="px-4 py-2.5 font-medium text-right">👍</th>
                      <th className="px-4 py-2.5 font-medium text-right">👎</th>
                      <th className="px-4 py-2.5 font-medium text-right">💬</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentDays.map((day) => (
                      <tr key={day.receivedAt} className="hover:bg-accent/40 transition-colors">
                        <td className="px-4 py-2.5">{formatDate(day.receivedAt)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{day.up}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{day.down}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{day.comments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {feedback.total === 0 && (
          <p className="text-sm text-muted-foreground">No email feedback recorded yet.</p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Site metrics — compact, from the latest snapshot                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Site metrics
          </h2>
          {latest && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Latest snapshot · {formatDate(latest.receivedAt)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
          <MetricCard
            icon={Eye}
            value={latest?.metrics.pageViews ?? 0}
            label="Page views"
          />
          <MetricCard
            icon={Users}
            value={latest?.metrics.subscribers ?? 0}
            label="Subscribers"
          />
          <MetricCard
            icon={MousePointerClick}
            value={latest?.metrics.directoryClicks ?? 0}
            label="Directory clicks"
          />
          <MetricCard
            icon={DollarSign}
            value={grossCents > 0 ? formatCents(grossCents) : "$0.00"}
            label="Product revenue"
            description={netCents > 0 ? <span>{formatCents(netCents)} net</span> : undefined}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Top tools */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Top tools
            </h3>
            {topTools.length === 0 ? (
              <div className="border border-border p-4">
                <p className="text-sm text-muted-foreground">No tool views yet.</p>
              </div>
            ) : (
              <Card className="gap-0 py-0 overflow-hidden">
                <div className="divide-y divide-border">
                  {topTools.map((tool) => (
                    <div
                      key={tool.slug}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Wrench className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                        <span className="truncate">{tool.slug}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {tool.views}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* Product revenue rows */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Product revenue
            </h3>
            {productRevenue.length === 0 ? (
              <div className="border border-border p-4">
                <p className="text-sm text-muted-foreground">No product revenue yet.</p>
              </div>
            ) : (
              <Card className="gap-0 py-0 overflow-hidden">
                <div className="divide-y divide-border">
                  {productRevenue.map((row) => (
                    <div
                      key={`${row.source}:${row.product_id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{row.product_title}</span>
                        <span className="text-xs text-muted-foreground">
                          {row.source} · {row.units} unit{row.units === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="tabular-nums shrink-0">
                        {formatCents(row.gross_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
