import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  socialsAnalyticsApi,
  type AnalyticsWindow,
  type AccountSummary,
  type FollowerPoint,
  type PostMetric,
  type BestTime,
  type Rec,
} from "../../api/socials-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Eye,
  Users,
  Heart,
  UserPlus,
  ChevronRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";

const WINDOWS: AnalyticsWindow[] = ["7d", "30d", "90d"];

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function pct(rate: number): string {
  if (!Number.isFinite(rate)) return "0%";
  return `${(rate * 100).toFixed(1)}%`;
}

function signed(n: number): string {
  return n > 0 ? `+${fmt(n)}` : fmt(n);
}

function dayHour(t: BestTime): string {
  const h = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const ap = t.hour < 12 ? "am" : "pm";
  return `${t.day} ${h}${ap}`;
}

// ── Total header metric ──────────────────────────────────────────────────────

function TotalMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Eye;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        </div>
        <Icon className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-1" />
      </div>
    </div>
  );
}

// ── Follower history sparkline (inline SVG) ──────────────────────────────────

function FollowerSparkline({ history }: { history: FollowerPoint[] }) {
  if (history.length < 2) {
    return <p className="text-xs text-muted-foreground">Not enough follower history yet.</p>;
  }
  const W = 320;
  const H = 64;
  const values = history.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = history.map((p, i) => {
    const x = (i / (history.length - 1)) * W;
    const y = H - ((p.value - min) / span) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = history[0];
  const last = history[history.length - 1];
  const delta = last.value - first.value;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>{first.date}</span>
        <span className={delta >= 0 ? "text-emerald-400" : "text-red-400"}>
          {signed(delta)} over window
        </span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}

// ── Best-times bars ──────────────────────────────────────────────────────────

function BestTimes({ times }: { times: BestTime[] }) {
  if (times.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No best-time signal yet.</p>;
  }
  const max = Math.max(...times.map((t) => t.score), 1);
  return (
    <div className="space-y-1">
      {times.slice(0, 6).map((t, i) => (
        <div key={`${t.day}-${t.hour}-${i}`} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{dayHour(t)}</span>
          <div className="flex-1 h-2 rounded bg-muted/30 overflow-hidden">
            <div
              className="h-full bg-violet-500"
              style={{ width: `${(t.score / max) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {t.score.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Recent posts table ───────────────────────────────────────────────────────

function RecentPosts({ posts }: { posts: PostMetric[] }) {
  if (posts.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No recent posts in this window.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase text-muted-foreground border-b">
            <th className="py-1 pr-2 font-medium">Post</th>
            <th className="py-1 px-2 font-medium text-right">Impr.</th>
            <th className="py-1 px-2 font-medium text-right">Reach</th>
            <th className="py-1 px-2 font-medium text-right">Likes</th>
            <th className="py-1 px-2 font-medium text-right">Comm.</th>
            <th className="py-1 px-2 font-medium text-right">Shares</th>
            <th className="py-1 px-2 font-medium text-right">Saves</th>
            <th className="py-1 pl-2 font-medium text-right">Eng.</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p, i) => (
            <tr key={p.platformPostId ?? p.zernioPostId ?? i} className="border-b last:border-0 hover:bg-accent/30">
              <td className="py-1.5 pr-2 max-w-[260px]">
                {p.platformPostUrl ? (
                  <a
                    href={p.platformPostUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate underline-offset-2 hover:underline"
                    title={p.contentPreview ?? undefined}
                  >
                    {p.contentPreview || p.platformPostId}
                  </a>
                ) : (
                  <span className="block truncate" title={p.contentPreview ?? undefined}>
                    {p.contentPreview || p.platformPostId}
                  </span>
                )}
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {new Date(p.publishedAt).toLocaleDateString()}
                </div>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">{fmt(p.impressions)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{fmt(p.reach)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{fmt(p.likes)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{fmt(p.comments)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{fmt(p.shares)}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{fmt(p.saves)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{pct(p.engagementRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Recommendation card ──────────────────────────────────────────────────────

function recBadge(action: Rec["action"]): { variant: "default" | "secondary" | "destructive" | "outline"; label: string } {
  switch (action) {
    case "post_more":
      return { variant: "default", label: "Post more" };
    case "change":
      return { variant: "secondary", label: "Change" };
    case "remove":
      return { variant: "destructive", label: "Remove" };
    case "keep":
    default:
      return { variant: "outline", label: "Keep" };
  }
}

function RecCard({ rec }: { rec: Rec }) {
  const b = recBadge(rec.action);
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" title={rec.subjectLabel}>
            {rec.subjectLabel}
          </div>
          <div className="text-[10px] uppercase text-muted-foreground">{rec.scope}</div>
        </div>
        <Badge variant={b.variant}>{b.label}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{rec.reason}</p>
      <div className="flex flex-wrap gap-1">
        {Object.entries(rec.signals).map(([k, v]) => (
          <span
            key={k}
            className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
          >
            {k}: {typeof v === "number" ? fmt(v) : v}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Account drill-down ───────────────────────────────────────────────────────

function AccountDrilldown({
  socialAccountId,
  window,
  onBack,
}: {
  socialAccountId: string;
  window: AnalyticsWindow;
  onBack: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["socials", "analytics", "account", socialAccountId, window],
    queryFn: () => socialsAnalyticsApi.account(socialAccountId, window),
  });
  const recsQuery = useQuery({
    queryKey: ["socials", "analytics", "recommendations", socialAccountId],
    queryFn: () => socialsAnalyticsApi.recommendations(socialAccountId),
  });

  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" onClick={onBack} className="gap-1">
        <ArrowLeft className="h-3.5 w-3.5" /> All accounts
      </Button>

      {isLoading || !data ? (
        <div className="text-sm text-muted-foreground">Loading account analytics…</div>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">
              {data.account.displayName || data.account.username}
            </h2>
            <div className="text-xs text-muted-foreground">
              {data.account.platform} · {data.account.username}
            </div>
          </div>

          {/* Account insights */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <TotalMetric icon={Users} value={fmt(data.accountInsights.reach)} label="Reach" />
            <TotalMetric icon={Eye} value={fmt(data.accountInsights.views)} label="Views" />
            <TotalMetric
              icon={UserPlus}
              value={fmt(data.accountInsights.accountsEngaged)}
              label="Accounts engaged"
            />
            <TotalMetric
              icon={Heart}
              value={fmt(data.accountInsights.totalInteractions)}
              label="Total interactions"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Follower history</CardTitle>
              </CardHeader>
              <CardContent>
                <FollowerSparkline history={data.followerHistory} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Best times to post</CardTitle>
              </CardHeader>
              <CardContent>
                <BestTimes times={data.bestTimes} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent posts</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentPosts posts={data.recentPosts} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recommendations</CardTitle>
            </CardHeader>
            <CardContent>
              {recsQuery.isLoading ? (
                <div className="text-xs text-muted-foreground">Loading recommendations…</div>
              ) : (recsQuery.data?.recommendations.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground italic">No recommendations.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {recsQuery.data!.recommendations.map((r) => (
                    <RecCard key={`${r.scope}-${r.subjectId}`} rec={r} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Account list row ─────────────────────────────────────────────────────────

function AccountRow({
  account,
  onOpen,
}: {
  account: AccountSummary;
  onOpen: () => void;
}) {
  const growth = account.followerGrowth;
  const GrowthIcon = growth > 0 ? ArrowUp : growth < 0 ? ArrowDown : Minus;
  const growthClass = growth > 0 ? "text-emerald-400" : growth < 0 ? "text-red-400" : "text-muted-foreground";
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center justify-between rounded border p-3 text-left hover:bg-accent/40 transition-colors"
    >
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">
          {account.displayName || account.username}
        </div>
        <div className="text-xs text-muted-foreground">
          {account.platform} · {account.username}
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <div className="text-xs font-mono tabular-nums">{fmt(account.impressions)}</div>
          <div className="text-[10px] text-muted-foreground">impr.</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono tabular-nums">{fmt(account.reach)}</div>
          <div className="text-[10px] text-muted-foreground">reach</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono tabular-nums">{pct(account.engagementRate)}</div>
          <div className="text-[10px] text-muted-foreground">eng.</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono tabular-nums">{fmt(account.followers)}</div>
          <div className={`text-[10px] flex items-center justify-end gap-0.5 ${growthClass}`}>
            <GrowthIcon className="h-2.5 w-2.5" />
            {signed(growth)}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function SocialsAnalytics() {
  const [window, setWindow] = useState<AnalyticsWindow>("30d");
  const [selected, setSelected] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["socials", "analytics", "overview", window],
    queryFn: () => socialsAnalyticsApi.overview(window),
  });
  const recsQuery = useQuery({
    queryKey: ["socials", "analytics", "recommendations", "all"],
    queryFn: () => socialsAnalyticsApi.recommendations("all"),
    enabled: !selected,
  });

  if (selected) {
    return (
      <AccountDrilldown
        socialAccountId={selected}
        window={window}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (overviewQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading analytics…</div>;
  }

  const data = overviewQuery.data;
  if (!data) {
    return (
      <div className="text-sm text-muted-foreground">
        No analytics available. Connect a Zernio account with the analytics add-on, then wait for the
        next poll.
      </div>
    );
  }

  const { totals } = data;

  return (
    <div className="space-y-4">
      {/* Window selector + sync state */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {data.connectedCount} Zernio-connected account{data.connectedCount === 1 ? "" : "s"}
          {data.lastSync && (
            <> · last sync {new Date(data.lastSync).toLocaleString()}</>
          )}
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === window ? "default" : "outline"}
              onClick={() => setWindow(w)}
            >
              {w}
            </Button>
          ))}
        </div>
      </div>

      {/* TOTAL header — aggregate across connected accounts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <TotalMetric icon={Eye} value={fmt(totals.impressions)} label="Impressions" />
        <TotalMetric icon={Users} value={fmt(totals.reach)} label="Reach" />
        <TotalMetric icon={Heart} value={pct(totals.avgEngagementRate)} label="Avg engagement" />
        <TotalMetric icon={UserPlus} value={fmt(totals.followers)} label="Followers" />
      </div>

      {/* Honesty note about excluded, unconnected accounts */}
      {data.unconnectedAccounts.length > 0 && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-yellow-500">Excluded from totals:</span>{" "}
          {data.unconnectedAccounts.length} account
          {data.unconnectedAccounts.length === 1 ? " is" : "s are"} not Zernio-connected
          ({data.unconnectedAccounts.join(", ")}) and carry no analytics.
        </div>
      )}

      {data.dataDelaysNote && (
        <div className="text-[11px] text-muted-foreground/70">{data.dataDelaysNote}</div>
      )}

      {/* Per-account clickable list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No connected accounts with data.</p>
          ) : (
            data.accounts.map((a) => (
              <AccountRow
                key={a.socialAccountId}
                account={a}
                onOpen={() => setSelected(a.socialAccountId)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Account-scope recommendations (deterministic) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          {recsQuery.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading recommendations…</div>
          ) : (recsQuery.data?.recommendations.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground italic">No recommendations yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recsQuery.data!.recommendations.map((r) => (
                <RecCard key={`${r.scope}-${r.subjectId}`} rec={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
