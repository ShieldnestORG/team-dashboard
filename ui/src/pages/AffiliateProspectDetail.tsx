import { useEffect, useRef, useState } from "react";
import { useParams } from "@/lib/router";
import { affiliatesApi, type AffiliateProspect } from "@/api/affiliates";
import { ExternalLink, Globe, MapPin, Tag, ArrowLeft } from "lucide-react";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = ["Overview", "Competitors", "Notes", "Updates"] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONBOARDING_BADGE: Record<string, { label: string; className: string }> = {
  none: { label: "Queued", className: "bg-muted text-muted-foreground border-border" },
  scraping: { label: "Scanning", className: "bg-blue-100 text-blue-700 border-blue-200" },
  analyzing: { label: "Analyzing", className: "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/30" },
  complete: { label: "Ready", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive border-destructive/30" },
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
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
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
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
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
      <div className="bg-card rounded-xl border border-border p-6 space-y-3">
        <h3 className="text-sm font-semibold text-foreground mb-4">Business Info</h3>
        <InfoRow
          icon={Globe}
          label="Website"
          value={
            prospect.website ? (
              <a
                href={prospect.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ff876d] hover:underline flex items-center gap-1"
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
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">Description</p>
            <p className="text-sm text-foreground">{prospect.description}</p>
          </div>
        )}
        {prospect.baselineAnalytics?.businessSummary && !prospect.description && (
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">AI Summary</p>
            <p className="text-sm text-muted-foreground italic">{prospect.baselineAnalytics.businessSummary}</p>
          </div>
        )}
      </div>

      {/* Services */}
      {prospect.services && prospect.services.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">Services</h3>
          <div className="flex flex-wrap gap-2">
            {prospect.services.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-full bg-muted text-foreground text-xs font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Onboarding Status */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-semibold text-foreground mb-3">Analysis Status</h3>
        <div className="flex items-start gap-3 flex-wrap">
          <StatusBadge status={prospect.onboardingStatus} />
          <p className="text-sm text-muted-foreground flex-1 min-w-[12rem]">
            {ONBOARDING_DESCRIPTIONS[prospect.onboardingStatus] ?? ""}
          </p>
          {prospect.onboardingStatus === "failed" && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="px-4 py-2 rounded-lg bg-[#ff876d] hover:bg-[#ff876d]/90 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
            >
              {retrying ? "Retrying…" : "Retry analysis"}
            </button>
          )}
        </div>
        {retryError && (
          <p className="mt-3 text-xs text-destructive">{retryError}</p>
        )}
      </div>
    </div>
  );
}

function CompetitorsTab({ prospect }: { prospect: AffiliateProspect }) {
  const competitors = prospect.baselineAnalytics?.competitorSites ?? [];

  if (prospect.onboardingStatus !== "complete" || competitors.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border py-16 text-center">
        <p className="text-muted-foreground text-sm">
          Competitor analysis is still being generated. Check back in a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {competitors.map((c) => (
        <div key={c.url} className="bg-card rounded-xl border border-border p-5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-foreground">{c.name}</h3>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 mt-0.5"
            >
              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-muted-foreground" />
            </a>
          </div>
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-[#ff876d] hover:underline"
          >
            {c.url.replace(/^https?:\/\//, "")}
          </a>
          <p className="text-sm text-muted-foreground leading-relaxed">{c.summary}</p>
        </div>
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
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div>
          <label className="block text-sm font-semibold text-foreground mb-1">Your Notes</label>
          <p className="text-xs text-muted-foreground mb-2">
            What do you know about this business? What's your relationship? Notes from your visits.
          </p>
          <textarea
            value={affiliateNotes}
            onChange={(e) => setAffiliateNotes(e.target.value)}
            rows={5}
            placeholder="Add your notes here..."
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-foreground mb-1">
            Store Notes <span className="text-muted-foreground font-normal">(Shared with Team)</span>
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            What does the store owner want and need? Visible to the Coherence Daddy team.
          </p>
          <textarea
            value={storeNotes}
            onChange={(e) => setStoreNotes(e.target.value)}
            rows={5}
            placeholder="Add notes about what the owner wants..."
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] resize-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="px-5 py-2 rounded-lg bg-[#ff876d] hover:bg-[#ff876d]/90 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
          >
            {saving ? "Saving..." : "Save Notes"}
          </button>
          {isDirty && !saving && (
            <span className="text-xs text-muted-foreground">(unsaved changes)</span>
          )}
          {saved && (
            <span className="text-xs text-green-600 font-medium">Saved!</span>
          )}
          {saveError && (
            <span className="text-xs text-destructive">{saveError}</span>
          )}
        </div>
      </div>
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
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Update Business Info</h3>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Business Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, State"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Website</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d]"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-[#ff876d] hover:bg-[#ff876d]/90 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
            {saveError && <span className="text-xs text-destructive">{saveError}</span>}
          </div>
        </form>
      </div>

      {/* Onboarding Status */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-semibold text-foreground mb-3">Analysis Status</h3>
        <div className="flex items-center gap-3 mb-2">
          <StatusBadge status={prospect.onboardingStatus} />
        </div>
        <p className="text-sm text-muted-foreground">
          {ONBOARDING_DESCRIPTIONS[prospect.onboardingStatus] ?? ""}
        </p>
      </div>
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !prospect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive mb-3">{error ?? "Prospect not found."}</p>
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
            <h1 className="text-xl font-bold text-foreground">{prospect.name}</h1>
            <StatusBadge status={prospect.onboardingStatus} />
            {(prospect.onboardingStatus === "scraping" || prospect.onboardingStatus === "analyzing" || prospect.onboardingStatus === "none") && (
              <span className="text-xs text-muted-foreground animate-pulse">Updating automatically...</span>
            )}
          </div>
          {prospect.website && (
            <a
              href={prospect.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#ff876d] mt-0.5 transition-colors"
            >
              <Globe className="h-3 w-3" />
              {prospect.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </header>

      {/* Tab Bar */}
      <div className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-[#ff876d] text-[#ff876d]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
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
    </div>
  );
}
