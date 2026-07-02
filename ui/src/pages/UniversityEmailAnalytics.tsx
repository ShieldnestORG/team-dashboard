import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { universityEmailStatsApi } from "../api/university-email-stats";
import type { UniversityEmailKindStats } from "../api/university-email-stats";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Mail,
  MailCheck,
  MousePointerClick,
  Send,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DateRange = "7d" | "30d" | "90d" | "all";

function dateRangeToISO(range: DateRange): string | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// Human labels for the university_* kinds in CreditscoreEmailKind
// (server/src/services/creditscore-email-callback.ts). Unknown kinds (free-text
// Brevo tags) fall back to a humanized raw kind — never hard-fail.
const KIND_LABELS: Record<string, string> = {
  university_welcome: "Welcome",
  university_receipt: "Payment receipt",
  university_past_due: "Payment past due",
  university_canceled: "Cancellation notice",
  university_onboarding_d1: "Onboarding day 1",
  university_onboarding_d3: "Onboarding day 3",
  university_winback: "Win-back",
  university_reengage_d7: "Re-engage (7 days quiet)",
  university_reengage_d14: "Re-engage (14 days quiet)",
  university_reengage_d30: "Re-engage (30 days quiet)",
  university_streak_nudge: "Streak nudge",
  university_community_reply: "Community reply",
  university_session_reminder_24h: "Session reminder (24h)",
  university_session_reminder_1h: "Session reminder (1h)",
  university_session_canceled: "Session canceled",
  university_session_rsvp_confirm: "RSVP confirmation",
  university_session_starting_now: "Session starting now",
  university_session_announce: "Session announcement",
  university_session_recap: "Session recap",
  university_session_waitlist_open: "Waitlist promotion",
};

function kindLabel(kind: string): string {
  return (
    KIND_LABELS[kind] ?? kind.replace(/^university_/, "").replace(/_/g, " ")
  );
}

// Rates arrive as 0–1 fractions (opened/clicked over DELIVERED, not sent).
function fmtRate(rate: number, delivered: number): string {
  if (delivered === 0) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function hasEngagement(k: UniversityEmailKindStats): boolean {
  return (
    k.delivered > 0 || k.opened > 0 || k.clicked > 0 || k.bounced > 0 || k.unsubscribed > 0
  );
}

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------

function SummaryTiles({ kinds }: { kinds: UniversityEmailKindStats[] }) {
  const totals = kinds.reduce(
    (acc, k) => ({
      sent: acc.sent + k.sent,
      delivered: acc.delivered + k.delivered,
      opened: acc.opened + k.opened,
      clicked: acc.clicked + k.clicked,
    }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0 },
  );

  const tiles = [
    {
      label: "Logged Sends",
      value: totals.sent,
      icon: <Send className="h-5 w-5 text-slate-400" />,
      tint: "bg-slate-500/10",
    },
    {
      label: "Delivered",
      value: totals.delivered,
      icon: <MailCheck className="h-5 w-5 text-green-500" />,
      tint: "bg-green-500/10",
    },
    {
      label: "Unique Opens",
      value: totals.opened,
      icon: <Eye className="h-5 w-5 text-blue-500" />,
      tint: "bg-blue-500/10",
    },
    {
      label: "Unique Clicks",
      value: totals.clicked,
      icon: <MousePointerClick className="h-5 w-5 text-purple-500" />,
      tint: "bg-purple-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="flex items-center gap-3 py-4">
            <div className={`rounded-md ${t.tint} p-2`}>{t.icon}</div>
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {t.value.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">{t.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaign table
// ---------------------------------------------------------------------------

function CampaignTable({ kinds }: { kinds: UniversityEmailKindStats[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (kind: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">By Campaign</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Campaign</th>
                <th className="px-2 py-2 text-right font-medium hidden md:table-cell">
                  Sent
                </th>
                <th className="px-2 py-2 text-right font-medium">Delivered</th>
                <th className="px-2 py-2 text-right font-medium">Opened</th>
                <th className="px-2 py-2 text-right font-medium">Clicked</th>
                <th className="px-2 py-2 text-right font-medium hidden lg:table-cell">
                  Bounced
                </th>
                <th className="px-2 py-2 text-right font-medium hidden lg:table-cell">
                  Unsubs
                </th>
                <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">
                  Open rate
                </th>
                <th className="px-4 py-2 text-right font-medium hidden sm:table-cell">
                  Click rate
                </th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => {
                const expandable = k.topClickedUrls.length > 0;
                const isOpen = expanded.has(k.kind);
                return (
                  <Fragment key={k.kind}>
                    <tr
                      className={cn(
                        "border-b last:border-0 hover:bg-muted/30",
                        expandable && "cursor-pointer",
                      )}
                      onClick={expandable ? () => toggle(k.kind) : undefined}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          {expandable ? (
                            isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )
                          ) : (
                            <span className="w-3.5 shrink-0" />
                          )}
                          <div>
                            <p className="font-medium">{kindLabel(k.kind)}</p>
                            <p className="text-[11px] text-muted-foreground font-mono">
                              {k.kind}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums hidden md:table-cell">
                        {k.sent === 0 && hasEngagement(k) ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          k.sent.toLocaleString()
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {k.delivered.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {k.opened.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {k.clicked.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums hidden lg:table-cell">
                        {k.bounced.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums hidden lg:table-cell">
                        {k.unsubscribed.toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">
                        {fmtRate(k.openRate, k.delivered)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums hidden sm:table-cell">
                        {fmtRate(k.clickRate, k.delivered)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b last:border-0 bg-muted/20">
                        <td colSpan={9} className="px-4 py-3">
                          <p className="text-xs text-muted-foreground mb-2">
                            Top clicked links (raw clicks — can exceed unique
                            clickers)
                          </p>
                          <div className="space-y-1">
                            {k.topClickedUrls.map((u) => (
                              <div
                                key={u.url}
                                className="flex items-center justify-between gap-4 text-xs"
                              >
                                <span className="truncate font-mono">
                                  {u.url}
                                </span>
                                <span className="tabular-nums text-muted-foreground shrink-0">
                                  {u.clicks.toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          — in Sent means this campaign type doesn't log sends (engagement
          events are still tracked). Open/click rates are over delivered, not
          sent. Opened/Clicked count unique recipients.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function UniversityEmailAnalytics() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  useEffect(() => {
    setBreadcrumbs([{ label: "University Emails" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const since = dateRangeToISO(dateRange);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.universityEmails.stats({ since: dateRange }),
    queryFn: () => universityEmailStatsApi.stats({ since }),
  });

  const kinds = data?.kinds ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">University Emails</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Delivery and engagement per email campaign — opens and clicks from
            Brevo events.
          </p>
        </div>
        <div className="flex items-center gap-1">
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

      {isLoading ? (
        <PageSkeleton variant="dashboard" />
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load email stats"}
        </p>
      ) : kinds.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Mail}
              message="No email events yet — data accumulates as campaigns send."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <SummaryTiles kinds={kinds} />
          <CampaignTable kinds={kinds} />
        </>
      )}
    </div>
  );
}
