import { useEffect, useState } from "react";
import { useParams } from "@/lib/router";
import {
  affiliatesApi,
  type AffiliateLead,
  type TimelineActivity,
} from "@/api/affiliates";
import { ArrowLeft, Clock, Globe, MapPin, Tag } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PIPELINE_STAGE_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
  submitted: { label: "Submitted", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  under_review: { label: "Under Review", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  contacted: { label: "Contacted", className: "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/30" },
  qualified: { label: "Qualified", className: "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/30" },
  demo_booked: { label: "Demo Booked", className: "bg-purple-500/15 text-purple-500 border-purple-500/30" },
  proposal: { label: "Proposal Sent", className: "bg-purple-500/15 text-purple-500 border-purple-500/30" },
  negotiation: { label: "In Negotiation", className: "bg-purple-500/15 text-purple-500 border-purple-500/30" },
  won: { label: "Won", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  onboarding: { label: "Onboarding", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  active: { label: "Active Client", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  lost: { label: "Lost", className: "bg-muted text-muted-foreground border-border" },
  expired: { label: "Expired", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

const ACTOR_LABEL: Record<string, string> = {
  affiliate: "You",
  admin: "Admin",
  cd: "Coherence Daddy",
  system: "System",
};

function PipelineStagePill({ stage }: { stage: string }) {
  const cfg =
    PIPELINE_STAGE_LABELS[stage] ??
    { label: stage.replace(/_/g, " "), className: "bg-muted text-muted-foreground border-border" };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "No activity yet";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const now = Date.now();
  const diffMs = now - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function humanizeActivityType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Timeline list
// ---------------------------------------------------------------------------

function TimelineList({ activities }: { activities: TimelineActivity[] }) {
  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
        <p className="text-muted-foreground text-sm">
          No activity yet. We'll post updates here as the lead moves through the pipeline.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {activities.map((a) => {
        const actor = ACTOR_LABEL[a.actorType] ?? a.actorType;
        return (
          <li
            key={a.id}
            className="bg-card rounded-xl border border-border p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">
                  {humanizeActivityType(a.activityType)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  · {actor}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {formatTimestamp(a.timestamp)}
              </span>
            </div>
            {a.note && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {a.note}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AffiliateLeadDetail() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<AffiliateLead | null>(null);
  const [activities, setActivities] = useState<TimelineActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([affiliatesApi.getLead(id), affiliatesApi.getLeadTimeline(id)])
      .then(([leadRes, timelineRes]) => {
        if (cancelled) return;
        // Timeline response also carries lead, but prefer dedicated lead endpoint.
        setLead(leadRes.lead ?? timelineRes.lead);
        setActivities(timelineRes.activities ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load lead");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive mb-3">{error ?? "Lead not found."}</p>
          <a href="/dashboard" className="text-sm text-[#ff876d] hover:underline">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </a>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-foreground">{lead.name}</h1>
            <PipelineStagePill stage={lead.pipelineStage} />
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Last activity: {formatRelativeTime(lead.lastActivityAt)}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Lead summary card */}
        <section className="bg-card rounded-xl border border-border p-5 space-y-2">
          <h2 className="text-sm font-semibold text-foreground mb-2">Lead</h2>
          {lead.website && (
            <div className="flex items-start gap-2 text-sm">
              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs text-muted-foreground w-20 shrink-0">Website</span>
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ff876d] hover:underline break-all"
              >
                {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            </div>
          )}
          {lead.location && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs text-muted-foreground w-20 shrink-0">Location</span>
              <span className="text-foreground">{lead.location}</span>
            </div>
          )}
          {lead.industry && (
            <div className="flex items-start gap-2 text-sm">
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs text-muted-foreground w-20 shrink-0">Industry</span>
              <span className="text-foreground">{lead.industry}</span>
            </div>
          )}
          <div className="flex items-start gap-2 text-sm pt-1">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground w-20 shrink-0">Submitted</span>
            <span className="text-foreground">
              {new Date(lead.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </section>

        {/* Timeline */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Activity Timeline</h2>
          <p className="text-xs text-muted-foreground">
            Updates from our team on this lead. Internal notes are hidden.
          </p>
          <TimelineList activities={activities} />
        </section>
      </main>
    </div>
  );
}
