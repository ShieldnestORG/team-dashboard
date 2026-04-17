import { useEffect, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  clearAffiliateToken,
  type Affiliate,
  type AffiliateProspect,
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

export function AffiliateDashboard() {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [prospects, setProspects] = useState<AffiliateProspect[]>([]);
  const [prospectCount, setProspectCount] = useState(0);
  const [estimatedEarned, setEstimatedEarned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [prospectUrl, setProspectUrl] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }

    Promise.all([affiliatesApi.me(), affiliatesApi.listProspects({ limit: 10 })])
      .then(([meRes, prospectsRes]) => {
        setAffiliate(meRes.affiliate);
        setProspectCount(meRes.prospectCount);
        setEstimatedEarned(meRes.estimatedEarned);
        setProspects(prospectsRes.prospects);
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

  async function handleSubmitProspect(e: React.FormEvent) {
    e.preventDefault();
    if (!prospectUrl.trim()) return;
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const res = await affiliatesApi.submitProspect(prospectUrl.trim());
      setShowModal(false);
      setProspectUrl("");
      window.location.href = `/prospects/${res.prospect.slug}`;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit prospect");
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
              {affiliate.commissionRate} commission
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
            onClick={() => setShowModal(true)}
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
                onClick={() => setShowModal(true)}
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
                        <OnboardingBadge status={p.onboardingStatus} />
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
      <Dialog open={showModal} onOpenChange={(open) => { if (!submitLoading) setShowModal(open); }}>
        <DialogContent>
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
            <DialogFooter>
              <button
                type="button"
                onClick={() => { setShowModal(false); setProspectUrl(""); setSubmitError(null); }}
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
    </div>
  );
}
