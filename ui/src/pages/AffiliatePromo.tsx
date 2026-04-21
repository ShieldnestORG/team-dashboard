import { useEffect, useMemo, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type PromoCampaign,
  type PromoPostSubmission,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusClass(status: string): string {
  switch (status) {
    case "live":
      return "bg-green-500/15 text-green-500 border-green-500/30";
    case "ended":
      return "bg-muted text-muted-foreground border-border";
    case "draft":
      return "bg-yellow-500/15 text-yellow-500 border-yellow-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function AffiliatePromo() {
  const [campaigns, setCampaigns] = useState<PromoCampaign[]>([]);
  const [posts, setPosts] = useState<PromoPostSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [hashtagUsed, setHashtagUsed] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [c, p] = await Promise.all([
        affiliatesApi.listPromoCampaigns(),
        affiliatesApi.listPromoPosts().catch(() => [] as PromoPostSubmission[]),
      ]);
      setCampaigns(c);
      setPosts(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load promo campaigns");
    } finally {
      setLoading(false);
    }
  }

  const liveCampaigns = useMemo(
    () => campaigns.filter((c) => c.status === "live"),
    [campaigns],
  );

  const giveawayCampaigns = useMemo(
    () => campaigns.filter((c) => c.giveawayEligible && c.giveawayPrize),
    [campaigns],
  );

  // When a campaign is selected, prefill hashtag for convenience.
  function handleCampaignChange(id: string) {
    setSelectedCampaignId(id);
    const campaign = liveCampaigns.find((c) => c.id === id);
    if (campaign) setHashtagUsed(campaign.hashtag);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCampaignId || !postUrl.trim() || !hashtagUsed.trim()) return;
    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      await affiliatesApi.submitPromoPost({
        campaignId: selectedCampaignId,
        postUrl: postUrl.trim(),
        hashtagUsed: hashtagUsed.trim(),
      });
      setSubmitSuccess("Post submitted. We'll review it shortly.");
      setPostUrl("");
      setHashtagUsed("");
      setSelectedCampaignId("");
      // Refresh submission history.
      const fresh = await affiliatesApi
        .listPromoPosts()
        .catch(() => posts);
      setPosts(fresh);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit post");
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AffiliateNav active="/promo" subtitle="Affiliate Program" title="Promo Campaigns" />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {loading ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <p className="text-muted-foreground text-sm">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            {/* Live campaigns */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Live campaigns</h2>
              {liveCampaigns.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    No campaigns are live right now. Check back soon.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {liveCampaigns.map((c) => (
                    <article
                      key={c.id}
                      className="rounded-xl border border-[#ff876d]/30 bg-card p-5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-bold text-foreground">{c.name}</h3>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusClass(c.status)}`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <p className="text-sm text-[#ff876d] font-mono">#{c.hashtag.replace(/^#/, "")}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatShortDate(c.startAt)} – {formatShortDate(c.endAt)}
                      </p>
                      {c.giveawayPrize && (
                        <p className="text-xs text-foreground">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ff876d]/15 text-[#ff876d] border border-[#ff876d]/30 mr-1">
                            Giveaway
                          </span>
                          {c.giveawayPrize}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Submission form */}
            {liveCampaigns.length > 0 && (
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="text-base font-semibold text-foreground">Submit a post</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Campaign
                    </label>
                    <select
                      required
                      value={selectedCampaignId}
                      onChange={(e) => handleCampaignChange(e.target.value)}
                      disabled={submitLoading}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                    >
                      <option value="">Select a campaign…</option>
                      {liveCampaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} (#{c.hashtag.replace(/^#/, "")})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Post URL
                    </label>
                    <input
                      type="url"
                      required
                      value={postUrl}
                      onChange={(e) => setPostUrl(e.target.value)}
                      placeholder="https://instagram.com/p/..."
                      disabled={submitLoading}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Hashtag used
                    </label>
                    <input
                      type="text"
                      required
                      value={hashtagUsed}
                      onChange={(e) => setHashtagUsed(e.target.value)}
                      placeholder="#coherencedaddy"
                      disabled={submitLoading}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                    />
                  </div>
                  {submitError && (
                    <p className="text-xs text-destructive">{submitError}</p>
                  )}
                  {submitSuccess && (
                    <p className="text-xs text-green-600">{submitSuccess}</p>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={
                        submitLoading ||
                        !selectedCampaignId ||
                        !postUrl.trim() ||
                        !hashtagUsed.trim()
                      }
                      className="px-5 py-2 rounded-lg bg-[#ff876d] hover:bg-[#ff876d]/90 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                    >
                      {submitLoading ? "Submitting…" : "Submit Post"}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* Giveaway entries */}
            {giveawayCampaigns.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">
                  Giveaway entries
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {giveawayCampaigns.map((c) => (
                    <div
                      key={`g-${c.id}`}
                      className="rounded-xl border border-[#ff876d]/40 bg-[#ff876d]/5 p-4"
                    >
                      <p className="text-xs uppercase tracking-wide text-[#ff876d] font-semibold">
                        Eligible
                      </p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">
                        {c.name}
                      </p>
                      {c.giveawayPrize && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Prize: {c.giveawayPrize}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Submission history */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Your submissions</h2>
              {posts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    You haven't submitted any posts yet.
                  </p>
                </div>
              ) : (
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Submitted</th>
                          <th className="px-4 py-3 font-medium">Campaign</th>
                          <th className="px-4 py-3 font-medium">Hashtag</th>
                          <th className="px-4 py-3 font-medium">Post</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {posts.map((p) => (
                          <tr
                            key={p.id}
                            className="border-b border-border last:border-0 hover:bg-background transition-colors"
                          >
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {formatShortDate(p.createdAt)}
                            </td>
                            <td className="px-4 py-3 text-sm text-foreground">
                              {p.campaignName ?? p.campaignId}
                            </td>
                            <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                              #{p.hashtagUsed.replace(/^#/, "")}
                            </td>
                            <td className="px-4 py-3">
                              <a
                                href={p.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#ff876d] hover:text-[#ff876d]/90 font-medium"
                              >
                                View →
                              </a>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-muted text-muted-foreground border-border">
                                {p.status ?? "pending"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
