import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitFork, ChevronRight, ChevronDown } from "lucide-react";
import { causalEventsApi, type CausalEvent } from "../api/causal-events";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

interface EventCardProps {
  event: CausalEvent;
  focus?: boolean;
  depth?: number;
  onSelect?: (id: string) => void;
}

function EventCard({ event, focus = false, depth = 0, onSelect }: EventCardProps) {
  const [expanded, setExpanded] = useState(focus);
  const hasDetails = event.details && Object.keys(event.details).length > 0;

  return (
    <div
      style={{ marginLeft: depth * 16 }}
      className={`rounded-md border p-3 text-xs ${
        focus
          ? "border-primary bg-primary/5 ring-1 ring-primary/40"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
            <span className="font-mono text-[11px] font-semibold">
              {event.kind ?? "(no kind)"}
            </span>
            {focus && (
              <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                focus
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{formatTime(event.createdAt)}</span>
            <span className="font-mono">
              {event.entityType}:{event.entityId.slice(0, 8)}
            </span>
            {event.runId && (
              <span className="font-mono">run:{event.runId.slice(0, 8)}</span>
            )}
          </div>
          {event.causedBy && event.causedBy.length > 0 && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              caused_by: {event.causedBy.map((id) => id.slice(0, 8)).join(", ")}
            </div>
          )}
        </div>
        {!focus && onSelect && (
          <button
            type="button"
            onClick={() => onSelect(event.id)}
            className="text-[11px] text-primary hover:underline"
          >
            focus
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-tight">
          {JSON.stringify(event.details, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function CausalEvents() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const [kindFilter, setKindFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Causal Events" }]);
  }, [setBreadcrumbs]);

  const listQuery = useQuery({
    queryKey: ["causal-events", "list", kindFilter, selectedCompanyId],
    queryFn: () =>
      causalEventsApi.list({
        kind: kindFilter || undefined,
        companyId: selectedCompanyId ?? undefined,
        limit: 100,
      }),
  });

  const kindsQuery = useQuery({
    queryKey: ["causal-events", "kinds"],
    queryFn: () => causalEventsApi.kinds(),
  });

  const detailQuery = useQuery({
    queryKey: ["causal-events", "detail", selectedId],
    queryFn: () => causalEventsApi.get(selectedId!),
    enabled: !!selectedId,
  });

  const events = listQuery.data?.events ?? [];

  const sortedAncestors = useMemo(() => {
    if (!detailQuery.data) return [];
    return [...detailQuery.data.ancestors].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [detailQuery.data]);

  const sortedDescendants = useMemo(() => {
    if (!detailQuery.data) return [];
    return [...detailQuery.data.descendants].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [detailQuery.data]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* Left pane — recent events list */}
      <div className="space-y-3">
        <div>
          <input
            type="text"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            placeholder="Filter by kind prefix (e.g. watchtower)"
            list="causal-events-kinds"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
          <datalist id="causal-events-kinds">
            {kindsQuery.data?.kinds.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </div>

        {listQuery.isLoading && <PageSkeleton variant="list" />}
        {listQuery.error && (
          <p className="text-xs text-destructive">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Failed to load events"}
          </p>
        )}

        {!listQuery.isLoading && events.length === 0 && (
          <EmptyState icon={GitFork} message="No causal events found." />
        )}

        <div className="max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto pr-1">
          {events.map((e) => (
            <button
              type="button"
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={`w-full rounded-md border p-2 text-left text-xs transition-colors ${
                selectedId === e.id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/50"
              }`}
            >
              <div className="truncate font-mono text-[11px] font-semibold">
                {e.kind ?? "(no kind)"}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {formatTime(e.createdAt)} · {e.entityType}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right pane — causal DAG */}
      <div className="space-y-3">
        {!selectedId && (
          <EmptyState
            icon={GitFork}
            message="Select an event to view its causal neighborhood."
          />
        )}

        {selectedId && detailQuery.isLoading && <PageSkeleton variant="list" />}

        {selectedId && detailQuery.error && (
          <p className="text-xs text-destructive">
            {detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "Failed to load event"}
          </p>
        )}

        {detailQuery.data && (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ancestors ({sortedAncestors.length})
              </h3>
              {sortedAncestors.length === 0 ? (
                <p className="text-xs text-muted-foreground">No ancestors.</p>
              ) : (
                <div className="space-y-2 border-l-2 border-border pl-3">
                  {sortedAncestors.map((a) => (
                    <EventCard
                      key={a.id}
                      event={a}
                      onSelect={setSelectedId}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Focus
              </h3>
              <EventCard event={detailQuery.data.event} focus />
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Descendants ({sortedDescendants.length})
              </h3>
              {sortedDescendants.length === 0 ? (
                <p className="text-xs text-muted-foreground">No descendants.</p>
              ) : (
                <div className="space-y-2 border-l-2 border-border pl-3">
                  {sortedDescendants.map((d) => (
                    <EventCard
                      key={d.id}
                      event={d}
                      onSelect={setSelectedId}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
