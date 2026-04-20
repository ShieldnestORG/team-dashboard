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
  none: { label: "Queued", className: "bg-gray-100 text-gray-600 border-gray-200" },
  scraping: { label: "Scanning", className: "bg-blue-100 text-blue-700 border-blue-200" },
  analyzing: { label: "Analyzing", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  complete: { label: "Ready", className: "bg-green-100 text-green-700 border-green-200" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700 border-red-200" },
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
  const [estimatedEarned, setEstimatedEarned] = useState(0);
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
        setEstimatedEarned(meRes.estimatedEarned);
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-gray-600">
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
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Minimal header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-lg mx-auto px-6 py-4 flex items-center justify-between">
            <span className="font-bold text-gray-900">Coherence Daddy</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Log out
            </button>
          </div>
        </header>
        {/* Holding content */}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-md">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-50 border border-amber-200 mb-6">
              <span className="text-2xl">⏳</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Application Under Review</h1>
            <p className="text-gray-500 mb-2">
              Your application is being reviewed by our team. We typically respond within 1–2 business days.
            </p>
            <p className="text-xs text-gray-400 mb-8">Applied on {appliedDate}</p>
            <p className="text-sm text-gray-500">
              Questions?{" "}
              <a
                href="mailto:affiliates@coherencedaddy.com"
                className="text-amber-600 hover:text-amber-700 font-medium"
              >
                affiliates@coherencedaddy.com
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-gray-400">Affiliate Dashboard</p>
            <h1 className="text-lg font-bold text-gray-900">Welcome, {affiliate.name}</h1>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
              {(parseFloat(affiliate.commissionRate) * 100).toFixed(0)}% commission
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
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
            className="rounded-xl border border-gray-200 bg-white p-6 text-left hover:border-amber-300 hover:shadow-sm transition-all"
          >
            <p className="text-lg font-bold text-gray-900">Go to Dashboard</p>
            <p className="text-sm text-gray-500 mt-1">View your submitted prospects and their status.</p>
          </button>
          <button
            onClick={handleOpenNewClient}
            className="rounded-xl border border-amber-400 bg-amber-50 p-6 text-left hover:bg-amber-100 hover:shadow-sm transition-all"
          >
            <p className="text-lg font-bold text-amber-700">New Client</p>
            <p className="text-sm text-amber-600 mt-1">Submit a new business lead to earn commission.</p>
          </button>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <span className="font-bold text-2xl text-gray-900">{prospectCount}</span>
            <span className="text-gray-500 ml-2">Prospects</span>
          </div>
          <div>
            <span className="font-bold text-2xl text-green-600">{convertedCount}</span>
            <span className="text-gray-500 ml-2">Converted</span>
          </div>
          <div>
            <span className="font-bold text-2xl text-gray-900">
              ${estimatedEarned.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-gray-500 ml-2">Est. Earnings</span>
          </div>
        </div>

        {/* Prospects List */}
        <section id="prospects" className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Your Prospects</h2>
          {prospects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
              <p className="text-gray-400 text-sm">No prospects yet.</p>
              <button
                onClick={handleOpenNewClient}
                className="mt-3 text-sm text-amber-600 hover:text-amber-700 font-medium"
              >
                Submit your first client
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-400">
                    <th className="px-4 py-3 font-medium">Business</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Status</th>
                    <th className="px-4 py-3 font-medium hidden md:table-cell">Submitted</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((p) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-400">{p.industry}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <OnboardingBadge status={p.onboardingStatus} />
                          {p.isPaying && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-green-100 text-green-700 border-green-200">
                              Converted
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                        {new Date(p.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/prospects/${p.slug}`}
                          className="text-xs font-medium text-amber-600 hover:text-amber-700"
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitProspect} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Business Website</label>
              <input
                type="url"
                required
                value={prospectUrl}
                onChange={(e) => setProspectUrl(e.target.value)}
                placeholder="https://clientwebsite.com"
                disabled={submitLoading}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              />
              {submitLoading && (
                <p className="text-xs text-gray-400 mt-1.5">
                  Analyzing website... this can take 30–60 seconds.
                </p>
              )}
              {submitError && (
                <p className="text-xs text-red-500 mt-1.5">{submitError}</p>
              )}
            </div>

            {/* Optional: lead context */}
            <div className="rounded-lg border border-gray-100">
              <button
                type="button"
                onClick={() => setShowLeadContext((v) => !v)}
                disabled={submitLoading}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-60"
                aria-expanded={showLeadContext}
              >
                <span>Tell us about this lead (optional)</span>
                <span className="text-gray-400" aria-hidden="true">
                  {showLeadContext ? "−" : "+"}
                </span>
              </button>
              {showLeadContext && (
                <div className="px-3 pb-3 pt-1 space-y-4 border-t border-gray-100">
                  {/* Already spoken */}
                  <label className="flex items-start gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={hasSpoken}
                      onChange={(e) => setHasSpoken(e.target.checked)}
                      disabled={submitLoading}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                    />
                    <span>I've already spoken with the owner</span>
                  </label>

                  {hasSpoken && (
                    <div className="space-y-3 pl-5 border-l-2 border-gray-100">
                      {/* Warmth */}
                      <div>
                        <p className="text-[11px] font-medium text-gray-600 mb-1.5">Relationship</p>
                        <div className="flex flex-wrap gap-2">
                          {WARMTH_OPTIONS.map((opt) => (
                            <label
                              key={opt.value}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] cursor-pointer transition-colors ${
                                warmth === opt.value
                                  ? "bg-amber-50 text-amber-700 border-amber-300"
                                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
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
                              <span className="text-gray-400">· {opt.hint}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Touch type + date */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">How you touched base</label>
                          <select
                            value={touchType}
                            onChange={(e) => setTouchType(e.target.value as ProspectFirstTouchType | "")}
                            disabled={submitLoading}
                            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
                          >
                            <option value="">Select…</option>
                            {TOUCH_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">When</label>
                          <input
                            type="date"
                            max={todayIsoDate()}
                            value={touchDate}
                            onChange={(e) => setTouchDate(e.target.value)}
                            disabled={submitLoading}
                            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
                          />
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">Short note (optional)</label>
                        <textarea
                          value={touchNotes}
                          onChange={(e) => setTouchNotes(e.target.value.slice(0, 500))}
                          disabled={submitLoading}
                          rows={2}
                          maxLength={500}
                          placeholder="Anything useful about the conversation…"
                          className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60 resize-none"
                        />
                        <p className="text-[10px] text-gray-400 mt-0.5 text-right">{touchNotes.length}/500</p>
                      </div>
                    </div>
                  )}

                  {/* Close path */}
                  <div>
                    <p className="text-[11px] font-medium text-gray-600 mb-1.5">Who closes?</p>
                    <div className="space-y-1.5">
                      {CLOSE_PATH_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                            closePath === opt.value
                              ? "bg-amber-50 text-amber-800 border-amber-300"
                              : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name="closePath"
                            value={opt.value}
                            checked={closePath === opt.value}
                            onChange={() => setClosePath(opt.value)}
                            disabled={submitLoading}
                            className="mt-0.5 h-3.5 w-3.5 border-gray-300 text-amber-500 focus:ring-amber-400"
                          />
                          <span className="flex-1">
                            <span className="block">{opt.label}</span>
                            {opt.helper && (
                              <span className="block text-[10px] text-amber-600 mt-0.5">{opt.helper}</span>
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
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitLoading || !prospectUrl.trim()}
                className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
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
          className="sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>One quick thing before you submit leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-700">
            <p>
              <span className="font-semibold text-gray-900">Lead Ownership.</span>{" "}
              When you submit a valid new business lead, that lead is reserved under your account
              for a limited ownership period. If the business signs during that period and your
              referral stays valid, you receive credit per program rules.
            </p>
            <p>
              <span className="font-semibold text-gray-900">Warm Introductions.</span>{" "}
              If you already know the owner or have spoken with them, log that in the lead form.
              Warm referrals often move faster and help us coordinate the best outreach plan.
            </p>
            <p>
              <span className="font-semibold text-gray-900">Closing Support.</span>{" "}
              You can introduce, follow up, or help support a deal — but you cannot promise
              pricing, discounts, guarantees, or custom terms unless Coherence Daddy approves it.
            </p>
            <p>
              <span className="font-semibold text-gray-900">Shared Credit.</span>{" "}
              Many deals close through a mix of your relationship and our sales process.
              If your referral is valid and tracked correctly, your credit stays protected.
            </p>
            <p>
              <span className="font-semibold text-gray-900">Duplicate Leads.</span>{" "}
              The first valid qualified submission usually wins ownership. Duplicates and edge
              cases are reviewed by admin.
            </p>
            <p className="pt-1">
              <a
                href="/affiliate-program-rules"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-600 hover:text-amber-700 font-medium"
              >
                Read full program rules →
              </a>
            </p>
            {policyError && (
              <p className="text-xs text-red-500">{policyError}</p>
            )}
          </div>
          <DialogFooter className="sm:justify-between items-center">
            <button
              type="button"
              onClick={handleLogout}
              disabled={policyLoading}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-60"
            >
              Log out
            </button>
            <button
              type="button"
              onClick={handleAcceptPolicy}
              disabled={policyLoading}
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
            >
              {policyLoading ? "Saving..." : "I understand and agree"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
