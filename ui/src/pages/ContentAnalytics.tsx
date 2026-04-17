import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useEffect } from "react";
import { contentClicksApi } from "../api/content";
import type { ContentClickEvent, ContentClickMetrics } from "../api/content";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MousePointerClick,
  Eye,
  Share2,
  Calendar,
  BarChart2,
  Users,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const EVENT_ICON: Record<string, React.ReactNode> = {
  click: <MousePointerClick className="h-4 w-4" />,
  view: <Eye className="h-4 w-4" />,
  share: <Share2 className="h-4 w-4" />,
};

const EVENT_COLOR: Record<string, string> = {
  click: "bg-blue-500/20 text-blue-400",
  view: "bg-green-500/20 text-green-400",
  share: "bg-purple-500/20 text-purple-400",
};

// ---------------------------------------------------------------------------
// Metric cards
// ---------------------------------------------------------------------------

function MetricsSection({ metrics }: { metrics: ContentClickMetrics }) {
  const byType = Object.fromEntries(metrics.byType.map((b) => [b.eventType, b.count]));
  const maxDay = Math.max(...(metrics.byDay?.map((d) => d.count) ?? []), 1);
  const totalOrigin = metrics.byOrigin?.reduce((s, o) => s + o.count, 0) || 1;
  const totalVisitor = metrics.byVisitorType?.reduce((s, v) => s + v.count, 0) || 1;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-slate-500/10 p-2">
              <BarChart2 className="h-5 w-5 text-slate-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.total.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Events</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-blue-500/10 p-2">
              <MousePointerClick className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{(byType.click ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Clicks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-green-500/10 p-2">
              <Eye className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{(byType.view ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Views</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-purple-500/10 p-2">
              <Share2 className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{(byType.share ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Shares</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Events by day chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Events by Day
          </CardTitle>
          <p className="text-xs text-muted-foreground">Last 30 days</p>
        </CardHeader>
        <CardContent>
          {!metrics.byDay || metrics.byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-end gap-[2px] h-40">
                {metrics.byDay.map((day) => {
                  const heightPct = (day.count / maxDay) * 100;
                  return (
                    <div key={day.date} className="flex-1 flex flex-col justify-end group relative">
                      <div
                        className="bg-primary hover:bg-primary/80 rounded-t transition-colors min-h-[2px] cursor-default"
                        style={{ height: `${Math.max(heightPct, 1.5)}%` }}
                      />
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 border shadow-sm">
                        {fmtDate(day.date)}: {day.count}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground pt-1">
                <span>{fmtDate(metrics.byDay[0].date)}</span>
                {metrics.byDay.length > 2 && (
                  <span>{fmtDate(metrics.byDay[Math.floor(metrics.byDay.length / 2)].date)}</span>
                )}
                <span>{fmtDate(metrics.byDay[metrics.byDay.length - 1].date)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* By origin */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">By Origin</CardTitle>
          </CardHeader>
          <CardContent>
            {!metrics.byOrigin || metrics.byOrigin.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data.</p>
            ) : (
              <div className="space-y-3">
                {metrics.byOrigin.map((o) => {
                  const pct = Math.round((o.count / totalOrigin) * 100);
                  return (
                    <div key={o.origin ?? "unknown"} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{o.origin ?? "unknown"}</span>
                        <span className="text-muted-foreground text-xs">
                          {o.count.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* By visitor type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Visitor Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!metrics.byVisitorType || metrics.byVisitorType.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No data.</p>
            ) : (
              <div className="space-y-3">
                {metrics.byVisitorType.map((v) => {
                  const pct = Math.round((v.count / totalVisitor) * 100);
                  return (
                    <div key={v.visitorType ?? "unknown"} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{v.visitorType ?? "unknown"}</span>
                        <span className="text-muted-foreground text-xs">
                          {v.count.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            v.visitorType === "human"
                              ? "bg-green-500"
                              : v.visitorType === "agent"
                              ? "bg-blue-500"
                              : "bg-muted-foreground"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event log table
// ---------------------------------------------------------------------------

function EventLog() {
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["content", "clicks", "list", page],
    queryFn: () => contentClicksApi.list({ limit, offset: page * limit }),
  });

  const rows: ContentClickEvent[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading events…
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <MousePointerClick className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">{total.toLocaleString()} events</CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium hidden sm:table-cell">Origin</th>
              <th className="px-4 py-2 font-medium hidden md:table-cell">Visitor</th>
              <th className="px-4 py-2 font-medium hidden lg:table-cell">Referrer</th>
              <th className="px-4 py-2 font-medium hidden xl:table-cell">UTM</th>
              <th className="px-4 py-2 font-medium hidden xl:table-cell">Content ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {fmtDateTime(row.clickedAt)}
                </td>
                <td className="px-4 py-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] gap-1 ${EVENT_COLOR[row.eventType] ?? ""}`}
                  >
                    {EVENT_ICON[row.eventType]}
                    {row.eventType}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                  {row.clickOrigin}
                </td>
                <td className="px-4 py-2 hidden md:table-cell">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      row.visitorType === "agent"
                        ? "bg-blue-500/20 text-blue-400"
                        : row.visitorType === "human"
                        ? "bg-green-500/20 text-green-400"
                        : ""
                    }`}
                  >
                    {row.visitorType ?? "unknown"}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[180px]">
                  {row.referrer ?? "-"}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground hidden xl:table-cell">
                  {row.utmSource ? `${row.utmSource}/${row.utmMedium ?? "-"}` : "-"}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground hidden xl:table-cell font-mono truncate max-w-[120px]">
                  {row.contentItemId.slice(0, 8)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ContentAnalytics() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Content Analytics" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ["content", "clicks", "metrics"],
    queryFn: () => contentClicksApi.metrics(),
  });

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Content Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Views, clicks, and shares across all content items — with full source attribution.
        </p>
      </div>

      {metricsLoading ? (
        <div className="text-sm text-muted-foreground">Loading metrics…</div>
      ) : metrics ? (
        <MetricsSection metrics={metrics} />
      ) : null}

      <div>
        <h2 className="text-sm font-semibold mb-3">Recent Events</h2>
        <EventLog />
      </div>
    </div>
  );
}
