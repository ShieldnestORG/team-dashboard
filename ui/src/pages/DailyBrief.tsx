import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useBoardAccess } from "../hooks/useBoardAccess";
import { socialsApi, type DailyBriefSections } from "../api/socials";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/HelpTip";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ApiError } from "../api/client";
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Filter,
  Eye,
  RefreshCw,
} from "lucide-react";

function SectionCard({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone?: "amber";
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <span className={cn(tone === "amber" ? "text-amber-500" : "text-emerald-500")}>{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted-foreground">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function BriefBody({ sections }: { sections: DailyBriefSections }) {
  if (sections.fallback) {
    return (
      <Card className="border-destructive/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Couldn't parse today's brief
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            The AI's answer came back in an unexpected format, so here's the raw text instead. {sections.fallback.parseError}
          </p>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap">
            {sections.fallback.rawText}
          </pre>
        </CardContent>
      </Card>
    );
  }

  const summary = sections.summary ?? [];
  const whatWorked = sections.whatWorked ?? [];
  const underutilized = sections.underutilized ?? [];
  const contentSuggestions = sections.contentSuggestions ?? {};
  const funnelSuggestions = sections.funnelSuggestions ?? [];
  const inspirationReview = sections.inspirationReview ?? [];

  // Sections come from LLM output. The server drops non-http(s) urls before
  // storing, but briefs are long-lived jsonb — re-check at render so a row
  // written by any other path can never become a javascript: link.
  const safeHref = (u: string): string => {
    try {
      const p = new URL(u);
      return p.protocol === "http:" || p.protocol === "https:" ? u : "#";
    } catch {
      return "#";
    }
  };

  return (
    <div className="space-y-4">
      {summary.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Today, in five bullets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BulletList items={summary} empty="No summary returned." />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionCard title="What worked" icon={<TrendingUp className="h-4 w-4" />}>
          <BulletList items={whatWorked} empty="Nothing stood out yet — check back after a few days of data." />
        </SectionCard>
        <SectionCard title="Underused" icon={<AlertTriangle className="h-4 w-4" />} tone="amber">
          <BulletList items={underutilized} empty="Everything's pulling its weight." />
        </SectionCard>
      </div>

      {Object.keys(contentSuggestions).length > 0 && (
        <SectionCard title="Content ideas" icon={<Lightbulb className="h-4 w-4" />}>
          <div className="space-y-3">
            {Object.entries(contentSuggestions).map(([handle, ideas]) => (
              <div key={handle}>
                <p className="text-xs font-medium text-muted-foreground">{handle}</p>
                <BulletList items={ideas} empty="No ideas returned." />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Funnel suggestions" icon={<Filter className="h-4 w-4" />}>
        <BulletList items={funnelSuggestions} empty="No funnel suggestions today." />
      </SectionCard>

      {inspirationReview.length > 0 && (
        <SectionCard title="Inspiration board review" icon={<Lightbulb className="h-4 w-4" />}>
          <div className="space-y-2">
            {inspirationReview.map((r) => (
              <div key={r.url} className="text-sm">
                <a href={safeHref(r.url)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {r.url}
                </a>
                <p className="text-muted-foreground">{r.comment}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {sections.llmVisibility && (
        <SectionCard title="AI answer-engine visibility" icon={<Eye className="h-4 w-4" />}>
          <p className="text-sm text-muted-foreground">{sections.llmVisibility}</p>
        </SectionCard>
      )}
    </div>
  );
}

export function DailyBrief() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { isInstanceAdmin } = useBoardAccess();
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Daily Brief" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const listQuery = useQuery({
    queryKey: queryKeys.dailyBrief.list(),
    queryFn: () => socialsApi.listBriefs(),
  });
  const dates = listQuery.data?.briefs.map((b) => b.briefDate) ?? [];

  const latestQuery = useQuery({
    queryKey: queryKeys.dailyBrief.latest,
    queryFn: () => socialsApi.latestBrief(),
    enabled: selectedDate === null,
    retry: false,
  });
  const dateQuery = useQuery({
    queryKey: queryKeys.dailyBrief.forDate(selectedDate ?? ""),
    queryFn: () => socialsApi.briefForDate(selectedDate as string),
    enabled: selectedDate !== null,
    retry: false,
  });

  const active = selectedDate === null ? latestQuery : dateQuery;
  const brief = active.data?.brief;
  const notFound = active.error instanceof ApiError && active.error.status === 404;

  const runMut = useMutation({
    mutationFn: () => socialsApi.runBriefNow(),
    onSuccess: () => {
      setRunError(null);
      qc.invalidateQueries({ queryKey: queryKeys.dailyBrief.latest });
      qc.invalidateQueries({ queryKey: queryKeys.dailyBrief.list() });
      setSelectedDate(null);
    },
    onError: (err) => setRunError(err instanceof ApiError ? err.message : "Run failed"),
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-xl font-semibold">
            Daily Brief
            <HelpTip label="What is the Daily Brief?">
              Every morning the AI reads the last 7 days across every account and writes this
              page. Green = keep doing, amber = underused.
            </HelpTip>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The last 7 days across every channel, read by AI once a day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dates.length > 0 && (
            <select
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={selectedDate ?? ""}
              onChange={(e) => setSelectedDate(e.target.value || null)}
            >
              <option value="">Latest</option>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {isInstanceAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runMut.mutate()}
              disabled={runMut.isPending}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", runMut.isPending && "animate-spin")} />
              {runMut.isPending ? "Running…" : "Run now"}
            </Button>
          )}
        </div>
      </div>

      {runError && <p className="text-sm text-destructive">{runError}</p>}

      {active.isLoading ? (
        <PageSkeleton variant="dashboard" />
      ) : notFound || !brief ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Sparkles}
              message={
                selectedDate
                  ? "No brief for that date."
                  : "No brief yet — the first one lands at 07:15 tomorrow, or an admin can run one now."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{brief.briefDate}</p>
          <BriefBody sections={brief.sections} />
        </>
      )}
    </div>
  );
}
