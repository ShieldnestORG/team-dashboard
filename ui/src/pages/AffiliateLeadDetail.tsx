import { useEffect, useState } from "react";
import { useParams } from "@/lib/router";
import {
  affiliatesApi,
  type AffiliateLead,
  type TimelineActivity,
} from "@/api/affiliates";
import { ArrowLeft, Clock, Globe, MapPin, Tag } from "lucide-react";
import { AffiliateNav } from "@/components/AffiliateNav";
import {
  CDPage,
  EditorialCard,
  LabelCaps,
  Mono,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Narrowed palette — Verdant for won/active, Rizz Coral for in-progress,
// Flare for expired, neutral for draft/lost. No blue/purple neon.
const PIPELINE_STAGE_LABELS: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  draft: { label: "Draft", bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.border },
  submitted: { label: "Submitted", bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.borderStrong },
  under_review: { label: "Under Review", bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.borderStrong },
  contacted: { label: "Contacted", bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  qualified: { label: "Qualified", bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  demo_booked: { label: "Demo Booked", bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  proposal: { label: "Proposal Sent", bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  negotiation: { label: "In Negotiation", bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  won: { label: "Won", bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  onboarding: { label: "Onboarding", bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  active: { label: "Active Client", bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  lost: { label: "Lost", bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.border },
  expired: { label: "Expired", bg: "rgba(217,67,67,0.10)", fg: CD.danger, border: "rgba(217,67,67,0.35)" },
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
    { label: stage.replace(/_/g, " "), bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.border };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1"
      style={{
        fontFamily: FONT_MONO,
        fontSize: "0.625rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        backgroundColor: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 4,
      }}
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
      <EditorialCard className="py-12 text-center" style={{ borderStyle: "dashed" }}>
        <p className="text-sm" style={{ color: CD.muted }}>
          No activity yet. We'll post updates here as the lead moves through the pipeline.
        </p>
      </EditorialCard>
    );
  }

  return (
    <ol className="space-y-3">
      {activities.map((a) => {
        const actor = ACTOR_LABEL[a.actorType] ?? a.actorType;
        return (
          <li key={a.id}>
            <EditorialCard className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: CD.ink }}>
                    {humanizeActivityType(a.activityType)}
                  </span>
                  <span className="text-[11px]" style={{ color: CD.muted }}>
                    · {actor}
                  </span>
                </div>
                <Mono className="text-[11px] whitespace-nowrap" style={{ color: CD.muted }}>
                  {formatTimestamp(a.timestamp)}
                </Mono>
              </div>
              {a.note && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: CD.muted }}>
                  {a.note}
                </p>
              )}
            </EditorialCard>
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
      <CDPage>
        <AffiliateNav subtitle="Affiliate" title="Lead" />
        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading lead…</LabelCaps>
          </EditorialCard>
        </main>
      </CDPage>
    );
  }

  if (error || !lead) {
    return (
      <CDPage>
        <AffiliateNav subtitle="Affiliate" title="Lead" />
        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <EditorialCard className="py-16 text-center">
            <p className="mb-3" style={{ color: CD.danger }}>{error ?? "Lead not found."}</p>
            <a href="/dashboard" className="text-sm hover:underline" style={{ color: CD.accent }}>
              Back to Dashboard
            </a>
          </EditorialCard>
        </main>
      </CDPage>
    );
  }

  return (
    <CDPage>
      <AffiliateNav subtitle="Affiliate" title="Lead" />

      {/* Header */}
      <header style={{ borderBottom: `1px solid ${CD.border}` }}>
        <div className="max-w-3xl mx-auto px-6 py-4">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs mb-2 transition-colors"
            style={{ color: CD.muted }}
            onMouseEnter={(e) => (e.currentTarget.style.color = CD.ink)}
            onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </a>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ color: CD.ink }}>{lead.name}</h1>
            <PipelineStagePill stage={lead.pipelineStage} />
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: CD.muted }}>
            <Clock className="h-3 w-3" />
            Last activity: {formatRelativeTime(lead.lastActivityAt)}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Lead summary card */}
        <EditorialCard className="p-5 space-y-2">
          <h2 className="text-sm font-semibold mb-2" style={{ color: CD.ink }}>Lead</h2>
          {lead.website && (
            <div className="flex items-start gap-2 text-sm">
              <Globe className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: CD.muted }} />
              <span className="text-xs w-20 shrink-0" style={{ color: CD.muted }}>Website</span>
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline break-all"
                style={{ color: CD.accent }}
              >
                {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            </div>
          )}
          {lead.location && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: CD.muted }} />
              <span className="text-xs w-20 shrink-0" style={{ color: CD.muted }}>Location</span>
              <span style={{ color: CD.ink }}>{lead.location}</span>
            </div>
          )}
          {lead.industry && (
            <div className="flex items-start gap-2 text-sm">
              <Tag className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: CD.muted }} />
              <span className="text-xs w-20 shrink-0" style={{ color: CD.muted }}>Industry</span>
              <span style={{ color: CD.ink }}>{lead.industry}</span>
            </div>
          )}
          <div className="flex items-start gap-2 text-sm pt-1">
            <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: CD.muted }} />
            <span className="text-xs w-20 shrink-0" style={{ color: CD.muted }}>Submitted</span>
            <span style={{ color: CD.ink }}>
              {new Date(lead.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </EditorialCard>

        {/* Timeline */}
        <section className="space-y-3">
          <LabelCaps as="div">Activity Timeline</LabelCaps>
          <p className="text-xs" style={{ color: CD.muted }}>
            Updates from our team on this lead. Internal notes are hidden.
          </p>
          <TimelineList activities={activities} />
        </section>
      </main>
    </CDPage>
  );
}
