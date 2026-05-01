import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { PageTabBar } from "../components/PageTabBar";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import {
  creditscoreReviewApi,
  type ContentDraft,
  type SchemaImpl,
  type CompetitorScan,
  type StrategyDoc,
} from "../api/creditscoreReview";
import { CreditScoreLeadsTab } from "./CreditScoreLeads";

type Tab = "leads" | "drafts" | "impls" | "scans" | "docs";
const TABS: Tab[] = ["leads", "drafts", "impls", "scans", "docs"];

function isTab(v: string): v is Tab {
  return (TABS as string[]).includes(v);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const tone = {
    pending_review: "bg-yellow-500/20 text-yellow-500",
    needs_revision: "bg-orange-500/20 text-orange-500",
    approved: "bg-green-500/20 text-green-500",
    rejected: "bg-red-500/20 text-red-500",
    published: "bg-blue-500/20 text-blue-500",
    delivered: "bg-blue-500/20 text-blue-500",
    complete: "bg-green-500/20 text-green-500",
    draft: "bg-muted text-muted-foreground",
    failed: "bg-red-500/20 text-red-500",
  }[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", tone)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ViolationChips({ ids, severity }: { ids: string[] | undefined; severity: "must" | "should" | "avoid" }) {
  if (!ids?.length) return null;
  const tone =
    severity === "must"
      ? "bg-red-500/15 text-red-500 border-red-500/30"
      : severity === "avoid"
        ? "bg-orange-500/15 text-orange-500 border-orange-500/30"
        : "bg-yellow-500/15 text-yellow-500 border-yellow-500/30";
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <span key={id} className={cn("rounded border px-1.5 py-0.5 text-[10px] font-mono", tone)}>
          {id}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content Drafts tab
// ---------------------------------------------------------------------------
function DraftsTab() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.creditscoreReview.contentDrafts,
    queryFn: () => creditscoreReviewApi.listContentDrafts(),
  });

  const items = data?.drafts ?? [];
  const selected = items.find((d) => d.id === selectedId) ?? null;

  const approve = useMutation({
    mutationFn: (id: string) => creditscoreReviewApi.approveContentDraft(id, notes || undefined),
    onSuccess: () => {
      setActionError(null);
      setNotes("");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: queryKeys.creditscoreReview.contentDrafts });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to approve"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => creditscoreReviewApi.rejectContentDraft(id, notes || undefined),
    onSuccess: () => {
      setActionError(null);
      setNotes("");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: queryKeys.creditscoreReview.contentDrafts });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to reject"),
  });

  if (isLoading) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <DraftList items={items} selectedId={selectedId} onSelect={setSelectedId} />
      <DraftDetail
        draft={selected}
        notes={notes}
        setNotes={setNotes}
        actionError={actionError}
        isPending={approve.isPending || reject.isPending}
        onApprove={() => selected && approve.mutate(selected.id)}
        onReject={() => selected && reject.mutate(selected.id)}
      />
    </div>
  );
}

function DraftList({
  items,
  selectedId,
  onSelect,
}: {
  items: ContentDraft[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!items.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No drafts awaiting review.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((d) => {
        const must = d.promptMeta?.ruleViolationsBySeverity?.must ?? [];
        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            className={cn(
              "block w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent",
              selectedId === d.id && "border-primary bg-accent",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{d.domain}</span>
                  <span>·</span>
                  <span>{d.targetSignal ?? "n/a"}</span>
                  <span>·</span>
                  <span>{fmtDate(d.createdAt)}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={d.status} />
                {must.length > 0 && (
                  <Badge variant="secondary" className="bg-red-500/15 text-red-500">
                    {must.length} must
                  </Badge>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DraftDetail({
  draft,
  notes,
  setNotes,
  actionError,
  isPending,
  onApprove,
  onReject,
}: {
  draft: ContentDraft | null;
  notes: string;
  setNotes: (v: string) => void;
  actionError: string | null;
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (!draft) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          Select a draft to review.
        </CardContent>
      </Card>
    );
  }
  const violations = draft.promptMeta?.ruleViolationsBySeverity ?? {};
  const canAct = draft.status === "pending_review" || draft.status === "needs_revision";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{draft.title}</h3>
            <StatusBadge status={draft.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{draft.domain}</span>
            <span>·</span>
            <span className="font-mono">/{draft.slug}</span>
            <span>·</span>
            <span>target: {draft.targetSignal ?? "n/a"}</span>
            <span>·</span>
            <span>{fmtDate(draft.createdAt)}</span>
          </div>
        </div>

        {(violations.must?.length || violations.should?.length || violations.avoid?.length) ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
              Self-check violations
            </div>
            {violations.must?.length ? (
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground">Must</div>
                <ViolationChips ids={violations.must} severity="must" />
              </div>
            ) : null}
            {violations.avoid?.length ? (
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground">Avoid</div>
                <ViolationChips ids={violations.avoid} severity="avoid" />
              </div>
            ) : null}
            {violations.should?.length ? (
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground">Should</div>
                <ViolationChips ids={violations.should} severity="should" />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-2 text-[10px] uppercase text-muted-foreground">Preview</div>
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: draft.htmlDraft }}
          />
        </div>

        {canAct && (
          <div className="space-y-2">
            <Textarea
              placeholder="Review notes (optional)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onReject} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                <span className="ml-1">Reject</span>
              </Button>
              <Button onClick={onApprove} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span className="ml-1">Approve</span>
              </Button>
            </div>
          </div>
        )}

        {draft.reviewNotes && (
          <div className="rounded-md border border-border p-3 text-xs">
            <div className="mb-1 text-[10px] uppercase text-muted-foreground">Review notes</div>
            <p>{draft.reviewNotes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Schema Impls tab
// ---------------------------------------------------------------------------
function ImplsTab() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.creditscoreReview.schemaImpls,
    queryFn: () => creditscoreReviewApi.listSchemaImpls(),
  });
  const items = data?.impls ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const approve = useMutation({
    mutationFn: (id: string) => creditscoreReviewApi.approveSchemaImpl(id, notes || undefined),
    onSuccess: () => {
      setActionError(null);
      setNotes("");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: queryKeys.creditscoreReview.schemaImpls });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to approve"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => creditscoreReviewApi.rejectSchemaImpl(id, notes || undefined),
    onSuccess: () => {
      setActionError(null);
      setNotes("");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: queryKeys.creditscoreReview.schemaImpls });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to reject"),
  });

  if (isLoading) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-2">
        {items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No schema impls awaiting review.</p>
            </CardContent>
          </Card>
        ) : (
          items.map((i: SchemaImpl) => {
            const must = i.promptMeta?.ruleViolationsBySeverity?.must ?? [];
            return (
              <button
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className={cn(
                  "block w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent",
                  selectedId === i.id && "border-primary bg-accent",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.schemaType}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{i.domain}</span>
                      <span>·</span>
                      <span>{fmtDate(i.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={i.status} />
                    {must.length > 0 && (
                      <Badge variant="secondary" className="bg-red-500/15 text-red-500">
                        {must.length} must
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {selected ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{selected.schemaType}</h3>
                <StatusBadge status={selected.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{selected.domain}</span>
                <span>·</span>
                <span>{selected.cycleTag}</span>
                <span>·</span>
                <span>{fmtDate(selected.createdAt)}</span>
              </div>
            </div>

            {(selected.promptMeta?.ruleViolationsBySeverity?.must?.length ||
              selected.promptMeta?.ruleViolationsBySeverity?.should?.length ||
              selected.promptMeta?.ruleViolationsBySeverity?.avoid?.length) ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                  Self-check violations
                </div>
                <ViolationChips ids={selected.promptMeta?.ruleViolationsBySeverity?.must} severity="must" />
                <ViolationChips ids={selected.promptMeta?.ruleViolationsBySeverity?.avoid} severity="avoid" />
                <ViolationChips ids={selected.promptMeta?.ruleViolationsBySeverity?.should} severity="should" />
              </div>
            ) : null}

            <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
              {JSON.stringify(selected.jsonLd, null, 2)}
            </pre>

            {(selected.status === "pending_review" || selected.status === "needs_revision") && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Review notes (optional)…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
                {actionError && <p className="text-sm text-destructive">{actionError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => reject.mutate(selected.id)} disabled={approve.isPending || reject.isPending}>
                    <XCircle className="h-4 w-4" />
                    <span className="ml-1">Reject</span>
                  </Button>
                  <Button onClick={() => approve.mutate(selected.id)} disabled={approve.isPending || reject.isPending}>
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="ml-1">Approve</span>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            Select an impl to review.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competitor Scans tab (read-only)
// ---------------------------------------------------------------------------
function ScansTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.creditscoreReview.competitorScans,
    queryFn: () => creditscoreReviewApi.listCompetitorScans(),
  });
  const items = data?.scans ?? [];
  if (isLoading) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!items.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Gauge className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No competitor scans yet.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Competitor</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Gap</th>
              <th className="px-3 py-2 text-left">Cycle</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">When</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s: CompetitorScan) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium">{s.competitorDomain}</span>
                  <span className="ml-1 text-xs text-muted-foreground">({s.competitorScore ?? "?"})</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{s.customerScore ?? "?"}</td>
                <td className="px-3 py-2 text-xs">{s.gapSummary ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{s.cycleTag}</td>
                <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Strategy Docs tab (read-only)
// ---------------------------------------------------------------------------
function DocsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.creditscoreReview.strategyDocs,
    queryFn: () => creditscoreReviewApi.listStrategyDocs(),
  });
  const items = data?.docs ?? [];
  const selected = items.find((d) => d.id === selectedId) ?? null;
  if (isLoading) return <PageSkeleton />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-2">
        {items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Gauge className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No strategy docs yet.</p>
            </CardContent>
          </Card>
        ) : (
          items.map((d: StrategyDoc) => (
            <button
              key={d.id}
              onClick={() => setSelectedId(d.id)}
              className={cn(
                "block w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent",
                selectedId === d.id && "border-primary bg-accent",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">Week {d.cycleTag}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    sub {d.subscriptionId.slice(0, 8)} · {fmtDate(d.createdAt)}
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>
            </button>
          ))
        )}
      </div>

      {selected ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">Week {selected.cycleTag}</h3>
              <StatusBadge status={selected.status} />
            </div>
            <div className="text-xs text-muted-foreground">
              Delivered: {fmtDate(selected.deliveredAt)}
            </div>
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: selected.docHtml }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            Select a doc to view.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
export function CreditScoreReview() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const seg = location.pathname.split("/").pop() ?? "leads";
  const tab: Tab = isTab(seg) ? seg : "leads";

  useEffect(() => {
    setBreadcrumbs([{ label: "CreditScore Review" }]);
  }, [setBreadcrumbs]);

  const { data: draftsData } = useQuery({
    queryKey: queryKeys.creditscoreReview.contentDrafts,
    queryFn: () => creditscoreReviewApi.listContentDrafts(),
  });
  const { data: implsData } = useQuery({
    queryKey: queryKeys.creditscoreReview.schemaImpls,
    queryFn: () => creditscoreReviewApi.listSchemaImpls(),
  });

  const pendingDrafts = useMemo(
    () => (draftsData?.drafts ?? []).filter((d) => d.status === "pending_review" || d.status === "needs_revision").length,
    [draftsData],
  );
  const pendingImpls = useMemo(
    () => (implsData?.impls ?? []).filter((i) => i.status === "pending_review" || i.status === "needs_revision").length,
    [implsData],
  );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => navigate(`/creditscore-review/${v}`)}>
        <PageTabBar
          value={tab}
          onValueChange={(v) => navigate(`/creditscore-review/${v}`)}
          items={[
            { value: "leads", label: "Leads" },
            {
              value: "drafts",
              label: (
                <>
                  Drafts
                  {pendingDrafts > 0 && (
                    <span className="ml-1.5 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
                      {pendingDrafts}
                    </span>
                  )}
                </>
              ),
            },
            {
              value: "impls",
              label: (
                <>
                  Schema
                  {pendingImpls > 0 && (
                    <span className="ml-1.5 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
                      {pendingImpls}
                    </span>
                  )}
                </>
              ),
            },
            { value: "scans", label: "Competitors" },
            { value: "docs", label: "Strategy" },
          ]}
        />
      </Tabs>

      {tab === "leads" && <CreditScoreLeadsTab />}
      {tab === "drafts" && <DraftsTab />}
      {tab === "impls" && <ImplsTab />}
      {tab === "scans" && <ScansTab />}
      {tab === "docs" && <DocsTab />}
    </div>
  );
}
