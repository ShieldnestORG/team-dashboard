import { useEffect, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  clearAffiliateToken,
  AffiliateApiError,
  type Affiliate,
  type AffiliateProspect,
  type ProspectClosePath,
  type ProspectFirstTouchType,
  type ProspectFirstTouchWarmth,
  type SubmitProspectOptions,
} from "@/api/affiliates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  none: { label: "Queued", className: "bg-muted text-muted-foreground border-border" },
  scraping: { label: "Scanning", className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  analyzing: { label: "Analyzing", className: "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/30" },
  complete: { label: "Ready", className: "bg-green-500/15 text-green-500 border-green-500/30" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

function OnboardingBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.none;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

const TOUCH_TYPE_OPTIONS: { value: ProspectFirstTouchType; label: string }[] = [
  { value: "in-person", label: "In-person visit" },
  { value: "call", label: "Phone call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "social-dm", label: "Social DM" },
];

const WARMTH_OPTIONS: { value: ProspectFirstTouchWarmth; label: string; hint: string }[] = [
  { value: "strong", label: "Strong", hint: "I know them well" },
  { value: "medium", label: "Medium", hint: "We've connected before" },
  { value: "weak", label: "Weak", hint: "Just a brief intro" },
];

const CLOSE_PATH_OPTIONS: { value: ProspectClosePath; label: string; helper?: string }[] = [
  { value: "cd", label: "Let Coherence Daddy close it." },
  { value: "shared", label: "We'll close it together." },
  {
    value: "affiliate",
    label: "I'll attempt first, then hand off.",
    helper: "Heads up: cold leads tend to do best when CD takes the first swing.",
  },
];

const POLICY_STEPS: { title: string; body: string }[] = [
  {
    title: "Lead Ownership",
    body: "When you submit a valid new business lead, that lead is reserved under your account for a limited ownership period. If the business signs during that period and your referral stays valid, you receive credit per program rules.",
  },
  {
    title: "Warm Introductions",
    body: "If you already know the owner or have spoken with them, log that in the lead form. Warm referrals often move faster and help us coordinate the best outreach plan.",
  },
  {
    title: "Closing Support",
    body: "You can introduce, follow up, or help support a deal — but you cannot promise pricing, discounts, guarantees, or custom terms unless Coherence Daddy approves it.",
  },
  {
    title: "Shared Credit",
    body: "Many deals close through a mix of your relationship and our sales process. If your referral is valid and tracked correctly, your credit stays protected.",
  },
  {
    title: "Duplicate Leads",
    body: "The first valid qualified submission usually wins ownership. Duplicates and edge cases are reviewed by admin.",
  },
];

function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function AffiliateDashboard() {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [prospects, setProspects] = useState<AffiliateProspect[]>([]);
  const [prospectCount, setProspectCount] = useState(0);
  const [convertedCount, setConvertedCount] = useState(0);
  const [pendingCents, setPendingCents] = useState(0);
  const [approvedCents, setApprovedCents] = useState(0);
  const [scheduledCents, setScheduledCents] = useState(0);
  const [paidCents, setPaidCents] = useState(0);
  const [lifetimeCents, setLifetimeCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [prospectUrl, setProspectUrl] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Optional "lead context" fields
  const [showLeadContext, setShowLeadContext] = useState(false);
  const [hasSpoken, setHasSpoken] = useState(false);
  const [warmth, setWarmth] = useState<ProspectFirstTouchWarmth | "">("");
  const [touchType, setTouchType] = useState<ProspectFirstTouchType | "">("");
  const [touchDate, setTouchDate] = useState("");
  const [touchNotes, setTouchNotes] = useState("");
  const [closePath, setClosePath] = useState<ProspectClosePath>("cd");

  // Policy acceptance
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyStep, setPolicyStep] = useState(0);
  const [policyProgress, setPolicyProgress] = useState(0);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }

    Promise.all([affiliatesApi.me(), affiliatesApi.listProspects({ limit: 10 })])
      .then(([meRes, prospectsRes]) => {
        setAffiliate(meRes.affiliate);
        setProspectCount(meRes.prospectCount);
        setConvertedCount(meRes.convertedCount);
        setPendingCents(meRes.pendingCents ?? 0);
        setApprovedCents(meRes.approvedCents ?? 0);
        setScheduledCents(meRes.scheduledCents ?? 0);
        setPaidCents(meRes.paidCents ?? 0);
        setLifetimeCents(meRes.lifetimeCents ?? 0);
        setProspects(prospectsRes.prospects);
        if (meRes.affiliate.status === "active" && !meRes.affiliate.policyAcceptedAt) {
          setShowPolicyModal(true);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => setLoading(false));
  }, []);

  function handleLogout() {
    clearAffiliateToken();
    window.location.href = "/";
  }

  function resetProspectForm() {
    setProspectUrl("");
    setShowLeadContext(false);
    setHasSpoken(false);
    setWarmth("");
    setTouchType("");
    setTouchDate("");
    setTouchNotes("");
    setClosePath("cd");
    setSubmitError(null);
  }

  function handleOpenNewClient() {
    if (affiliate && affiliate.status === "active" && !affiliate.policyAcceptedAt) {
      setShowPolicyModal(true);
      return;
    }
    setShowModal(true);
  }

  useEffect(() => {
    if (showPolicyModal) {
      setPolicyStep(0);
      setPolicyError(null);
    }
  }, [showPolicyModal]);

  // 10-second read timer that re-starts on every step transition
  useEffect(() => {
    if (!showPolicyModal) return;
    const STEP_DURATION_MS = 10_000;
    setPolicyProgress(0);
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const p = Math.min(1, elapsed / STEP_DURATION_MS);
      setPolicyProgress(p);
      if (p >= 1) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [policyStep, showPolicyModal]);

  async function handleAcceptPolicy() {
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      const res = await affiliatesApi.acceptPolicy();
      setAffiliate((prev) => (prev ? { ...prev, policyAcceptedAt: res.acceptedAt } : prev));
      setShowPolicyModal(false);
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : "Failed to accept policy");
    } finally {
      setPolicyLoading(false);
    }
  }

  async function handleSubmitProspect(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prospectUrl.trim();
    if (!trimmed) return;
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      // Build optional payload. If nothing optional is set, send only { url }.
      const options: SubmitProspectOptions = {};
      if (showLeadContext && hasSpoken) {
        const firstTouch: SubmitProspectOptions["firstTouch"] = { logged: true };
        if (warmth) firstTouch.warmth = warmth;
        if (touchType) firstTouch.type = touchType;
        if (touchDate) firstTouch.date = new Date(touchDate).toISOString();
        if (touchNotes.trim()) firstTouch.notes = touchNotes.trim().slice(0, 500);
        options.firstTouch = firstTouch;
      }
      if (showLeadContext && closePath && closePath !== "cd") {
        options.closePath = closePath;
      }
      const res = await affiliatesApi.submitProspect(
        trimmed,
        Object.keys(options).length > 0 ? options : undefined,
      );
      setShowModal(false);
      resetProspectForm();
      window.location.href = `/prospects/${res.prospect.slug}`;
    } catch (err) {
      if (err instanceof AffiliateApiError && err.status === 403 && err.code === "POLICY_NOT_ACCEPTED") {
        setShowModal(false);
        setShowPolicyModal(true);
        setSubmitError(null);
      } else {
        setSubmitError(err instanceof Error ? err.message : "Failed to submit prospect");
      }
    } finally {
      setSubmitLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <button onClick={handleLogout} className="text-sm text-muted-foreground hover:text-muted-foreground">
            Log out
          </button>
        </div>
      </div>
    );
  }

  if (!affiliate) return null;

  if (affiliate.status === "pending") {
    const appliedDate = new Date(affiliate.createdAt).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Minimal header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-lg mx-auto px-6 py-4 flex items-center justify-between">
            <span className="font-bold text-foreground">Coherence Daddy</span>
            <button
              onClick={handleLogout}
              className="text-sm text-muted-foreground hover:text-muted-foreground"
            >
              Log out
            </button>
          </div>
        </header>
        {/* Holding content */}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-md">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#ff876d]/10 border border-[#ff876d]/30 mb-6">
              <span className="text-2xl">⏳</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-3">Application Under Review</h1>
            <p className="text-muted-foreground mb-2">
              Your application is being reviewed by our team. We typically respond within 1–2 business days.
            </p>
            <p className="text-xs text-muted-foreground mb-8">Applied on {appliedDate}</p>
            <p className="text-sm text-muted-foreground">
              Questions?{" "}
              <a
                href="mailto:info@coherencedaddy.com"
                className="text-[#ff876d] hover:text-[#ff876d] font-medium"
              >
                info@coherencedaddy.com
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Affiliate Dashboard</p>
            <h1 className="text-lg font-bold text-foreground">Welcome, {affiliate.name}</h1>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#ff876d]/20 text-[#ff876d] border border-[#ff876d]/30">
              {(parseFloat(affiliate.commissionRate) * 100).toFixed(0)}% commission
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Log Out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Action Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => document.getElementById("prospects")?.scrollIntoView({ behavior: "smooth" })}
            className="rounded-xl border border-border bg-card p-6 text-left hover:border-[#ff876d]/40 hover:shadow-sm transition-all"
          >
            <p className="text-lg font-bold text-foreground">Go to Dashboard</p>
            <p className="text-sm text-muted-foreground mt-1">View your submitted prospects and their status.</p>
          </button>
          <button
            onClick={handleOpenNewClient}
            className="rounded-xl border border-[#ff876d]/60 bg-[#ff876d]/10 p-6 text-left hover:bg-[#ff876d]/20 hover:shadow-sm transition-all"
          >
            <p className="text-lg font-bold text-[#ff876d]">New Client</p>
            <p className="text-sm text-[#ff876d] mt-1">Submit a new business lead to earn commission.</p>
          </button>
        </div>

        {/* Lead stats */}
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <span className="font-bold text-2xl text-foreground">{prospectCount}</span>
            <span className="text-muted-foreground ml-2">Prospects</span>
          </div>
          <div>
            <span className="font-bold text-2xl text-green-600">{convertedCount}</span>
            <span className="text-muted-foreground ml-2">Converted</span>
          </div>
        </div>

        {/* Earnings buckets */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Earnings</h2>
            <a
              href="/earnings"
              className="text-xs font-medium text-[#ff876d] hover:text-[#ff876d]/90"
            >
              View all →
            </a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <a
              href="/earnings?status=pending_activation"
              className="rounded-xl border border-border bg-card p-4 hover:border-[#ff876d]/40 transition-colors"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pending</p>
              <p className="mt-1 text-xl font-bold text-[#ff876d]">{formatDollars(pendingCents)}</p>
            </a>
            <a
              href="/earnings?status=approved"
              className="rounded-xl border border-border bg-card p-4 hover:border-border/80 transition-colors"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Approved</p>
              <p className="mt-1 text-xl font-bold text-foreground">{formatDollars(approvedCents)}</p>
            </a>
            <a
              href="/earnings?status=scheduled_for_payout"
              className="rounded-xl border border-border bg-card p-4 hover:border-border/80 transition-colors"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Scheduled</p>
              <p className="mt-1 text-xl font-bold text-foreground">{formatDollars(scheduledCents)}</p>
            </a>
            <a
              href="/earnings?status=paid"
              className="rounded-xl border border-border bg-card p-4 hover:border-border/80 transition-colors"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Paid</p>
              <p className="mt-1 text-xl font-bold text-green-500">{formatDollars(paidCents)}</p>
            </a>
            <a
              href="/payouts"
              className="rounded-xl border border-border bg-card p-4 hover:border-border/80 transition-colors"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Lifetime</p>
              <p className="mt-1 text-xl font-bold text-foreground">{formatDollars(lifetimeCents)}</p>
            </a>
          </div>
        </section>

        {/* Prospects List */}
        <section id="prospects" className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Your Prospects</h2>
          {prospects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
              <p className="text-muted-foreground text-sm">No prospects yet.</p>
              <button
                onClick={handleOpenNewClient}
                className="mt-3 text-sm text-[#ff876d] hover:text-[#ff876d] font-medium"
              >
                Submit your first client
              </button>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Business</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Status</th>
                    <th className="px-4 py-3 font-medium hidden md:table-cell">Submitted</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((p) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-background transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.industry}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <OnboardingBadge status={p.onboardingStatus} />
                          {p.isPaying && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-green-500/15 text-green-500 border-green-500/30">
                              Converted
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                        {new Date(p.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/prospects/${p.slug}`}
                          className="text-xs font-medium text-[#ff876d] hover:text-[#ff876d]"
                        >
                          View
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* New Client Modal */}
      <Dialog
        open={showModal}
        onOpenChange={(open) => {
          if (submitLoading) return;
          setShowModal(open);
          if (!open) resetProspectForm();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitProspect} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Business Website</label>
              <input
                type="url"
                required
                value={prospectUrl}
                onChange={(e) => setProspectUrl(e.target.value)}
                placeholder="https://clientwebsite.com"
                disabled={submitLoading}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
              />
              {submitLoading && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Analyzing website... this can take 30–60 seconds.
                </p>
              )}
              {submitError && (
                <p className="text-xs text-destructive mt-1.5">{submitError}</p>
              )}
            </div>

            {/* Optional: lead context */}
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowLeadContext((v) => !v)}
                disabled={submitLoading}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
                aria-expanded={showLeadContext}
              >
                <span>Tell us about this lead (optional)</span>
                <span className="text-muted-foreground" aria-hidden="true">
                  {showLeadContext ? "−" : "+"}
                </span>
              </button>
              {showLeadContext && (
                <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border">
                  {/* Already spoken */}
                  <label className="flex items-start gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={hasSpoken}
                      onChange={(e) => setHasSpoken(e.target.checked)}
                      disabled={submitLoading}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border text-[#ff876d] focus:ring-[#ff876d]"
                    />
                    <span>I've already spoken with the owner</span>
                  </label>

                  {hasSpoken && (
                    <div className="space-y-3 pl-5 border-l-2 border-border">
                      {/* Warmth */}
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Relationship</p>
                        <div className="flex flex-wrap gap-2">
                          {WARMTH_OPTIONS.map((opt) => (
                            <label
                              key={opt.value}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] cursor-pointer transition-colors ${
                                warmth === opt.value
                                  ? "bg-[#ff876d]/10 text-[#ff876d] border-[#ff876d]/40"
                                  : "bg-card text-muted-foreground border-border hover:border-border"
                              }`}
                            >
                              <input
                                type="radio"
                                name="warmth"
                                value={opt.value}
                                checked={warmth === opt.value}
                                onChange={() => setWarmth(opt.value)}
                                disabled={submitLoading}
                                className="sr-only"
                              />
                              <span className="font-medium">{opt.label}</span>
                              <span className="text-muted-foreground">· {opt.hint}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Touch type + date */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-muted-foreground mb-1">How you touched base</label>
                          <select
                            value={touchType}
                            onChange={(e) => setTouchType(e.target.value as ProspectFirstTouchType | "")}
                            disabled={submitLoading}
                            className="w-full rounded-md border border-border px-2.5 py-1.5 text-xs bg-card focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                          >
                            <option value="">Select…</option>
                            {TOUCH_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-muted-foreground mb-1">When</label>
                          <input
                            type="date"
                            max={todayIsoDate()}
                            value={touchDate}
                            onChange={(e) => setTouchDate(e.target.value)}
                            disabled={submitLoading}
                            className="w-full rounded-md border border-border px-2.5 py-1.5 text-xs bg-card focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                          />
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Short note (optional)</label>
                        <textarea
                          value={touchNotes}
                          onChange={(e) => setTouchNotes(e.target.value.slice(0, 500))}
                          disabled={submitLoading}
                          rows={2}
                          maxLength={500}
                          placeholder="Anything useful about the conversation…"
                          className="w-full rounded-md border border-border px-2.5 py-1.5 text-xs bg-card focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60 resize-none"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5 text-right">{touchNotes.length}/500</p>
                      </div>
                    </div>
                  )}

                  {/* Close path */}
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Who closes?</p>
                    <div className="space-y-1.5">
                      {CLOSE_PATH_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                            closePath === opt.value
                              ? "bg-[#ff876d]/10 text-[#ff876d] border-[#ff876d]/40"
                              : "bg-card text-foreground border-border hover:border-border"
                          }`}
                        >
                          <input
                            type="radio"
                            name="closePath"
                            value={opt.value}
                            checked={closePath === opt.value}
                            onChange={() => setClosePath(opt.value)}
                            disabled={submitLoading}
                            className="mt-0.5 h-3.5 w-3.5 border-border text-[#ff876d] focus:ring-[#ff876d]"
                          />
                          <span className="flex-1">
                            <span className="block">{opt.label}</span>
                            {opt.helper && (
                              <span className="block text-[10px] text-[#ff876d] mt-0.5">{opt.helper}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => { setShowModal(false); resetProspectForm(); }}
                disabled={submitLoading}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitLoading || !prospectUrl.trim()}
                className="px-5 py-2 rounded-lg bg-[#ff876d] hover:bg-[#ff876d]/90 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {submitLoading ? "Analyzing website..." : "Lock it In"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Policy Acceptance Modal (blocking) */}
      <Dialog open={showPolicyModal} onOpenChange={() => { /* blocking: cannot dismiss */ }}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>One quick thing before you submit leads</DialogTitle>
          </DialogHeader>

          {/* Progress bars — current step fills over 10 seconds */}
          <div className="flex items-center gap-1.5 mt-1">
            {POLICY_STEPS.map((_, i) => {
              const fill = i < policyStep ? 1 : i === policyStep ? policyProgress : 0;
              return (
                <span
                  key={i}
                  className="h-1 flex-1 rounded-full bg-muted overflow-hidden"
                >
                  <span
                    className="block h-full bg-[#ff876d] origin-left"
                    style={{ transform: `scaleX(${fill})` }}
                  />
                </span>
              );
            })}
          </div>

          <div className="min-h-[160px] space-y-3 text-sm text-foreground">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Rule {policyStep + 1} of {POLICY_STEPS.length}
            </p>
            <h3 className="text-lg font-semibold text-foreground">
              {POLICY_STEPS[policyStep].title}
            </h3>
            <p className="leading-relaxed text-muted-foreground">
              {POLICY_STEPS[policyStep].body}
            </p>

            {policyStep === POLICY_STEPS.length - 1 && (
              <p className="pt-2">
                <a
                  href="/affiliate-program-rules"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#ff876d] hover:text-[#ff876d]/90 font-medium"
                >
                  Read full program rules →
                </a>
              </p>
            )}

            {policyError && (
              <p className="text-xs text-destructive">{policyError}</p>
            )}
          </div>

          <DialogFooter className="sm:justify-between items-center">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handleLogout}
                disabled={policyLoading}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Log out
              </button>
              {policyStep > 0 && (
                <button
                  type="button"
                  onClick={() => setPolicyStep((s) => Math.max(0, s - 1))}
                  disabled={policyLoading}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  ← Back
                </button>
              )}
            </div>
            {(() => {
              const canProceed = policyProgress >= 1;
              const secondsLeft = Math.ceil((1 - policyProgress) * 10);
              const isFinal = policyStep === POLICY_STEPS.length - 1;
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (!canProceed) return;
                    if (isFinal) {
                      handleAcceptPolicy();
                    } else {
                      setPolicyStep((s) => Math.min(POLICY_STEPS.length - 1, s + 1));
                    }
                  }}
                  disabled={policyLoading || !canProceed}
                  className="px-5 py-2 rounded-lg bg-[#ff876d] hover:bg-[#ff876d]/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors min-w-[10rem]"
                >
                  {!canProceed
                    ? `Keep reading… ${secondsLeft}s`
                    : isFinal
                    ? policyLoading
                      ? "Saving..."
                      : "I understand and agree"
                    : "Next →"}
                </button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
