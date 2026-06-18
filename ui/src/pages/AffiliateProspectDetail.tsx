import { useEffect, useRef, useState } from "react";
import { useParams } from "@/lib/router";
import { affiliatesApi, type AffiliateProspect } from "@/api/affiliates";
import { ExternalLink, Globe, MapPin, Tag, ArrowLeft, Handshake, Flame, Calendar } from "lucide-react";
import { AffiliateNav } from "@/components/AffiliateNav";
import {
  CDPage,
  CDPrimaryButton,
  EditorialCard,
  LabelCaps,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = ["Overview", "Competitors", "Notes", "Updates"] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Shared input styling — dark surface, hairline border, matches the CD affiliate
// surfaces. Coral focus is conveyed via the consistent accent system elsewhere.
const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${CD.border}`,
  backgroundColor: "rgba(255,255,255,0.025)",
  color: CD.ink,
  padding: "8px 12px",
  fontSize: "0.875rem",
};

const ONBOARDING_BADGE: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  none: { label: "Queued", bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.border },
  scraping: { label: "Scanning", bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.borderStrong },
  analyzing: { label: "Analyzing", bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  complete: { label: "Ready", bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  failed: { label: "Failed", bg: "rgba(217,67,67,0.10)", fg: CD.danger, border: "rgba(217,67,67,0.35)" },
};

const ONBOARDING_DESCRIPTIONS: Record<string, string> = {
  none: "This prospect is queued and will be analyzed soon.",
  scraping: "We are currently scanning the business website.",
  analyzing: "Our AI is analyzing the scraped data and building the full profile.",
  complete: "Analysis complete — competitor data, keywords, and business summary are ready.",
  failed: "Something went wrong during analysis. Please try submitting again.",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = ONBOARDING_BADGE[status] ?? ONBOARDING_BADGE.none;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5"
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

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe;
  label: string;
  value: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: CD.muted }} />
      <span className="text-xs w-20 shrink-0" style={{ color: CD.muted }}>{label}</span>
      <span className="text-sm" style={{ color: CD.ink }}>{value}</span>
    </div>
  );
}

const FIRST_TOUCH_TYPE_LABELS: Record<string, string> = {
  in_person: "In person",
  call: "Phone call",
  text: "Text message",
  email: "Email",
  social_dm: "Social DM",
};

const WARMTH_LABELS: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  strong: { label: "Warm intro", bg: "rgba(74,157,124,0.10)", fg: CD.success, border: "rgba(74,157,124,0.35)" },
  medium: { label: "Some rapport", bg: "rgba(255,107,74,0.10)", fg: CD.accent, border: "rgba(255,107,74,0.35)" },
  weak: { label: "First contact", bg: "rgba(255,255,255,0.04)", fg: CD.muted, border: CD.border },
};

function FirstTouchCard({ prospect }: { prospect: AffiliateProspect }) {
  const ft = prospect.firstTouch;

  // Nothing to show unless the affiliate logged a first touch.
  if (!ft || !ft.logged) return null;

  const warmth = ft.warmth ? WARMTH_LABELS[ft.warmth] : undefined;
  const typeLabel = ft.type ? FIRST_TOUCH_TYPE_LABELS[ft.type] ?? ft.type : null;
  const dateLabel = ft.date ? new Date(ft.date).toLocaleDateString() : null;

  return (
    <EditorialCard className="p-6 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Handshake className="h-4 w-4" style={{ color: CD.accent }} />
        <h3 className="text-sm font-semibold" style={{ color: CD.ink }}>First touch</h3>
      </div>
      <p className="text-xs -mt-1 mb-3" style={{ color: CD.muted }}>
        Warm intros move faster and help us prioritize outreach.
      </p>
      {warmth && (
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 shrink-0" style={{ color: CD.muted }} />
          <span className="text-xs w-20 shrink-0" style={{ color: CD.muted }}>Relationship</span>
          <span
            className="inline-flex items-center px-2 py-0.5"
            style={{
              fontFamily: FONT_MONO,
              fontSize: "0.625rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              backgroundColor: warmth.bg,
              color: warmth.fg,
              border: `1px solid ${warmth.border}`,
              borderRadius: 4,
            }}
          >
            {warmth.label}
          </span>
        </div>
      )}
      <InfoRow icon={Handshake} label="How" value={typeLabel} />
      <InfoRow icon={Calendar} label="When" value={dateLabel} />
      {ft.notes && (
        <div className="pt-3" style={{ borderTop: `1px solid ${CD.border}` }}>
          <p className="text-xs mb-1" style={{ color: CD.muted }}>Your notes</p>
          <p className="text-sm" style={{ color: CD.ink }}>{ft.notes}</p>
        </div>
      )}
    </EditorialCard>
  );
}

// ---------------------------------------------------------------------------
// Tab Content Components
// ---------------------------------------------------------------------------

function OverviewTab({
  prospect,
  onRetry,
  retrying,
  retryError,
}: {
  prospect: AffiliateProspect;
  onRetry: () => void;
  retrying: boolean;
  retryError: string | null;
}) {
  return (
    <div className="space-y-6">
      {/* Business Info */}
      <EditorialCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold mb-4" style={{ color: CD.ink }}>Business Info</h3>
        <InfoRow
          icon={Globe}
          label="Website"
          value={
            prospect.website ? (
              <a
                href={prospect.website}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline flex items-center gap-1"
                style={{ color: CD.accent }}
              >
                {prospect.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null
          }
        />
        <InfoRow icon={MapPin} label="Location" value={prospect.location} />
        <InfoRow icon={Tag} label="Industry" value={prospect.industry} />
        {prospect.description && (
          <div className="pt-3" style={{ borderTop: `1px solid ${CD.border}` }}>
            <p className="text-xs mb-1" style={{ color: CD.muted }}>Description</p>
            <p className="text-sm" style={{ color: CD.ink }}>{prospect.description}</p>
          </div>
        )}
        {prospect.baselineAnalytics?.businessSummary && !prospect.description && (
          <div className="pt-3" style={{ borderTop: `1px solid ${CD.border}` }}>
            <p className="text-xs mb-1" style={{ color: CD.muted }}>AI Summary</p>
            <p className="text-sm italic" style={{ color: CD.muted }}>{prospect.baselineAnalytics.businessSummary}</p>
          </div>
        )}
      </EditorialCard>

      {/* First touch (only when the affiliate logged one) */}
      <FirstTouchCard prospect={prospect} />

      {/* Services */}
      {prospect.services && prospect.services.length > 0 && (
        <EditorialCard className="p-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: CD.ink }}>Services</h3>
          <div className="flex flex-wrap gap-2">
            {prospect.services.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", color: CD.ink }}
              >
                {s}
              </span>
            ))}
          </div>
        </EditorialCard>
      )}

      {/* Onboarding Status */}
      <EditorialCard className="p-6">
        <h3 className="text-sm font-semibold mb-3" style={{ color: CD.ink }}>Analysis Status</h3>
        <div className="flex items-start gap-3 flex-wrap">
          <StatusBadge status={prospect.onboardingStatus} />
          <p className="text-sm flex-1 min-w-[12rem]" style={{ color: CD.muted }}>
            {ONBOARDING_DESCRIPTIONS[prospect.onboardingStatus] ?? ""}
          </p>
          {prospect.onboardingStatus === "failed" && (
            <CDPrimaryButton type="button" onClick={onRetry} disabled={retrying}>
              {retrying ? "Retrying…" : "Retry analysis"}
            </CDPrimaryButton>
          )}
        </div>
        {retryError && (
          <p className="mt-3 text-xs" style={{ color: CD.danger }}>{retryError}</p>
        )}
      </EditorialCard>
    </div>
  );
}

function CompetitorsTab({ prospect }: { prospect: AffiliateProspect }) {
  const competitors = prospect.baselineAnalytics?.competitorSites ?? [];

  if (prospect.onboardingStatus !== "complete" || competitors.length === 0) {
    return (
      <EditorialCard className="py-16 text-center">
        <p className="text-sm" style={{ color: CD.muted }}>
          Competitor analysis is still being generated. Check back in a minute.
        </p>
      </EditorialCard>
    );
  }

  return (
    <div className="space-y-4">
      {competitors.map((c) => (
        <EditorialCard key={c.url} className="p-5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold" style={{ color: CD.ink }}>{c.name}</h3>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 mt-0.5"
            >
              <ExternalLink className="h-4 w-4" style={{ color: CD.muted }} />
            </a>
          </div>
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs hover:underline"
            style={{ color: CD.accent }}
          >
            {c.url.replace(/^https?:\/\//, "")}
          </a>
          <p className="text-sm leading-relaxed" style={{ color: CD.muted }}>{c.summary}</p>
        </EditorialCard>
      ))}
    </div>
  );
}

function NotesTab({ prospect }: { prospect: AffiliateProspect }) {
  const [affiliateNotes, setAffiliateNotes] = useState(prospect.affiliateNotes ?? "");
  const [storeNotes, setStoreNotes] = useState(prospect.storeNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const origAffiliateNotes = useRef(prospect.affiliateNotes ?? "");
  const origStoreNotes = useRef(prospect.storeNotes ?? "");

  const isDirty =
    affiliateNotes !== origAffiliateNotes.current ||
    storeNotes !== origStoreNotes.current;

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await affiliatesApi.updateNotes(prospect.slug, { affiliateNotes, storeNotes });
      origAffiliateNotes.current = affiliateNotes;
      origStoreNotes.current = storeNotes;
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <EditorialCard className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-1" style={{ color: CD.ink }}>Your Notes</label>
          <p className="text-xs mb-2" style={{ color: CD.muted }}>
            What do you know about this business? What's your relationship? Notes from your visits.
          </p>
          <textarea
            value={affiliateNotes}
            onChange={(e) => setAffiliateNotes(e.target.value)}
            rows={5}
            placeholder="Add your notes here..."
            style={{ ...inputStyle, resize: "none" }}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1" style={{ color: CD.ink }}>
            Store Notes <span className="font-normal" style={{ color: CD.muted }}>(Shared with Team)</span>
          </label>
          <p className="text-xs mb-2" style={{ color: CD.muted }}>
            What does the store owner want and need? Visible to the Coherence Daddy team.
          </p>
          <textarea
            value={storeNotes}
            onChange={(e) => setStoreNotes(e.target.value)}
            rows={5}
            placeholder="Add notes about what the owner wants..."
            style={{ ...inputStyle, resize: "none" }}
          />
        </div>
        <div className="flex items-center gap-3">
          <CDPrimaryButton onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "Saving..." : "Save Notes"}
          </CDPrimaryButton>
          {isDirty && !saving && (
            <span className="text-xs" style={{ color: CD.muted }}>(unsaved changes)</span>
          )}
          {saved && (
            <span className="text-xs font-medium" style={{ color: CD.success }}>Saved!</span>
          )}
          {saveError && (
            <span className="text-xs" style={{ color: CD.danger }}>{saveError}</span>
          )}
        </div>
      </EditorialCard>
    </div>
  );
}

function UpdatesTab({ prospect }: { prospect: AffiliateProspect }) {
  const [name, setName] = useState(prospect.name);
  const [location, setLocation] = useState(prospect.location ?? "");
  const [website, setWebsite] = useState(prospect.website ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await affiliatesApi.updateProspect(prospect.slug, {
        name: name.trim() || undefined,
        location: location.trim() || undefined,
        website: website.trim() || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Edit Fields */}
      <EditorialCard className="p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: CD.ink }}>Update Business Info</h3>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: CD.ink }}>Business Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: CD.ink }}>Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, State"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: CD.ink }}>Website</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              style={inputStyle}
            />
          </div>
          <div className="flex items-center gap-3">
            <CDPrimaryButton type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </CDPrimaryButton>
            {saved && <span className="text-xs font-medium" style={{ color: CD.success }}>Saved!</span>}
            {saveError && <span className="text-xs" style={{ color: CD.danger }}>{saveError}</span>}
          </div>
        </form>
      </EditorialCard>

      {/* Onboarding Status */}
      <EditorialCard className="p-6">
        <h3 className="text-sm font-semibold mb-3" style={{ color: CD.ink }}>Analysis Status</h3>
        <div className="flex items-center gap-3 mb-2">
          <StatusBadge status={prospect.onboardingStatus} />
        </div>
        <p className="text-sm" style={{ color: CD.muted }}>
          {ONBOARDING_DESCRIPTIONS[prospect.onboardingStatus] ?? ""}
        </p>
      </EditorialCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AffiliateProspectDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [prospect, setProspect] = useState<AffiliateProspect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetry = async () => {
    if (!prospect?.website || !slug) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await affiliatesApi.submitProspect(prospect.website);
      // Backend reset onboardingStatus to 'none'. Refetch so polling restarts.
      const res = await affiliatesApi.getProspect(slug);
      setProspect(res.prospect);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (!slug) return;
    affiliatesApi
      .getProspect(slug)
      .then((res) => setProspect(res.prospect))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    // Only poll while onboarding is not terminal
    if (!prospect) return;
    if (prospect.onboardingStatus === "complete" || prospect.onboardingStatus === "failed") return;

    const interval = setInterval(async () => {
      try {
        const res = await affiliatesApi.getProspect(slug!);
        setProspect(res.prospect);
      } catch {
        // silently ignore poll errors
      }
    }, 6000); // poll every 6 seconds

    return () => clearInterval(interval);
  }, [prospect?.onboardingStatus, slug]);

  if (loading) {
    return (
      <CDPage>
        <AffiliateNav subtitle="Affiliate" title="Prospect" />
        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading prospect…</LabelCaps>
          </EditorialCard>
        </main>
      </CDPage>
    );
  }

  if (error || !prospect) {
    return (
      <CDPage>
        <AffiliateNav subtitle="Affiliate" title="Prospect" />
        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <EditorialCard className="py-16 text-center">
            <p className="mb-3" style={{ color: CD.danger }}>{error ?? "Prospect not found."}</p>
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
      <AffiliateNav subtitle="Affiliate" title="Prospect" />

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
            <h1 className="text-xl font-bold" style={{ color: CD.ink }}>{prospect.name}</h1>
            <StatusBadge status={prospect.onboardingStatus} />
            {(prospect.onboardingStatus === "scraping" || prospect.onboardingStatus === "analyzing" || prospect.onboardingStatus === "none") && (
              <span className="text-xs animate-pulse" style={{ color: CD.muted }}>Updating automatically...</span>
            )}
          </div>
          {prospect.website && (
            <a
              href={prospect.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs mt-0.5 transition-colors"
              style={{ color: CD.muted }}
              onMouseEnter={(e) => (e.currentTarget.style.color = CD.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
            >
              <Globe className="h-3 w-3" />
              {prospect.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </header>

      {/* Tab Bar */}
      <div style={{ borderBottom: `1px solid ${CD.border}` }}>
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex gap-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-4 py-3 text-sm font-medium transition-colors"
                  style={{
                    borderBottom: `2px solid ${isActive ? CD.accent : "transparent"}`,
                    color: isActive ? CD.accent : CD.muted,
                    background: "transparent",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.color = CD.ink;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = CD.muted;
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        {activeTab === "Overview" && (
          <OverviewTab
            prospect={prospect}
            onRetry={handleRetry}
            retrying={retrying}
            retryError={retryError}
          />
        )}
        {activeTab === "Competitors" && <CompetitorsTab prospect={prospect} />}
        {activeTab === "Notes" && <NotesTab prospect={prospect} />}
        {activeTab === "Updates" && <UpdatesTab prospect={prospect} />}
      </main>
    </CDPage>
  );
}
