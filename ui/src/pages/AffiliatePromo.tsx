import { useEffect, useMemo, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type PromoCampaign,
  type PromoPostSubmission,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";
import {
  CDPage,
  EditorialCard,
  BrutalistCard,
  LabelCaps,
  Mono,
  Cascade,
  CDPrimaryButton,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusPalette(status: string): { fg: string; bg: string; border: string } {
  switch (status) {
    case "live":
      return {
        fg: CD.success,
        bg: "rgba(74,157,124,0.10)",
        border: "rgba(74,157,124,0.35)",
      };
    case "ended":
      return {
        fg: CD.muted,
        bg: "rgba(255,255,255,0.04)",
        border: CD.border,
      };
    case "draft":
      return {
        fg: CD.accent,
        bg: "rgba(255,107,74,0.08)",
        border: "rgba(255,107,74,0.30)",
      };
    default:
      return {
        fg: CD.muted,
        bg: "rgba(255,255,255,0.04)",
        border: CD.border,
      };
  }
}

function StatusChip({ status }: { status: string }) {
  const p = statusPalette(status);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5"
      style={{
        fontFamily: FONT_MONO,
        fontSize: "0.625rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: p.fg,
        backgroundColor: p.bg,
        border: `1px solid ${p.border}`,
        borderRadius: 4,
      }}
    >
      {status}
    </span>
  );
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
      setCampaigns(c.campaigns);
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
      const fresh = await affiliatesApi.listPromoPosts().catch(() => posts);
      setPosts(fresh);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit post");
    } finally {
      setSubmitLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.03)",
    border: `1px solid ${CD.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    color: CD.ink,
    fontSize: "0.875rem",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <CDPage>
      <AffiliateNav active="/promo" subtitle="Affiliate" title="Promo Campaigns" />

      <main className="mx-auto w-full max-w-[1200px] px-6 py-10 space-y-8">
        {loading ? (
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading campaigns…</LabelCaps>
          </EditorialCard>
        ) : error ? (
          <div
            className="p-4 text-sm"
            style={{
              backgroundColor: "rgba(217,67,67,0.08)",
              border: `1px solid rgba(217,67,67,0.35)`,
              color: CD.danger,
              borderRadius: 10,
            }}
          >
            {error}
          </div>
        ) : (
          <>
            {/* Live campaigns */}
            <section className="space-y-4">
              <div className="flex items-baseline justify-between">
                <LabelCaps color={CD.accent}>Live campaigns</LabelCaps>
                <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                  {liveCampaigns.length} running
                </Mono>
              </div>
              {liveCampaigns.length === 0 ? (
                <EditorialCard className="py-12 text-center" style={{ borderStyle: "dashed" }}>
                  <p className="text-sm" style={{ color: CD.muted }}>
                    No campaigns are live right now. Check back soon.
                  </p>
                </EditorialCard>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {liveCampaigns.map((c, i) => (
                    <Cascade key={c.id} index={i}>
                      <BrutalistCard
                        fill={CD.surface}
                        borderColor={CD.ink}
                        showScanLines={false}
                      >
                        <div className="space-y-3 px-5 py-5">
                          <div className="flex items-center justify-between gap-2">
                            <LabelCaps color={CD.accent}>{c.name}</LabelCaps>
                            <StatusChip status={c.status} />
                          </div>
                          <p
                            style={{
                              fontFamily: FONT_MONO,
                              fontSize: "1.5rem",
                              fontWeight: 600,
                              color: CD.accent,
                              letterSpacing: "-0.01em",
                            }}
                          >
                            #{c.hashtag.replace(/^#/, "")}
                          </p>
                          <p>
                            <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                              {formatShortDate(c.startAt)} — {formatShortDate(c.endAt)}
                            </Mono>
                          </p>
                          {c.giveawayPrize && (
                            <div
                              className="flex items-start gap-2 pt-2"
                              style={{ borderTop: `1px solid ${CD.border}` }}
                            >
                              <span
                                style={{
                                  fontFamily: FONT_MONO,
                                  fontSize: "0.5625rem",
                                  letterSpacing: "0.14em",
                                  textTransform: "uppercase",
                                  color: CD.accent,
                                  border: `1px solid rgba(255,107,74,0.40)`,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  marginTop: 2,
                                }}
                              >
                                Giveaway
                              </span>
                              <span className="text-sm" style={{ color: CD.ink }}>
                                {c.giveawayPrize}
                              </span>
                            </div>
                          )}
                        </div>
                      </BrutalistCard>
                    </Cascade>
                  ))}
                </div>
              )}
            </section>

            {/* Submission form */}
            {liveCampaigns.length > 0 && (
              <EditorialCard className="p-6 space-y-4">
                <LabelCaps color={CD.accent}>Submit a post</LabelCaps>
                <p className="text-sm" style={{ color: CD.muted }}>
                  Drop a public link to your post. We'll check the hashtag and credit your account.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <LabelCaps as="div">Campaign</LabelCaps>
                    <select
                      required
                      value={selectedCampaignId}
                      onChange={(e) => handleCampaignChange(e.target.value)}
                      disabled={submitLoading}
                      className="mt-1.5 disabled:opacity-60"
                      style={inputStyle}
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
                    <LabelCaps as="div">Post URL</LabelCaps>
                    <input
                      type="url"
                      required
                      value={postUrl}
                      onChange={(e) => setPostUrl(e.target.value)}
                      placeholder="https://instagram.com/p/…"
                      disabled={submitLoading}
                      className="mt-1.5 disabled:opacity-60"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <LabelCaps as="div">Hashtag used</LabelCaps>
                    <input
                      type="text"
                      required
                      value={hashtagUsed}
                      onChange={(e) => setHashtagUsed(e.target.value)}
                      placeholder="#coherencedaddy"
                      disabled={submitLoading}
                      className="mt-1.5 disabled:opacity-60"
                      style={{ ...inputStyle, fontFamily: FONT_MONO }}
                    />
                  </div>
                  {submitError && (
                    <p className="text-xs" style={{ color: CD.danger }}>{submitError}</p>
                  )}
                  {submitSuccess && (
                    <p className="text-xs" style={{ color: CD.success }}>{submitSuccess}</p>
                  )}
                  <div className="flex justify-end">
                    <CDPrimaryButton
                      type="submit"
                      disabled={
                        submitLoading ||
                        !selectedCampaignId ||
                        !postUrl.trim() ||
                        !hashtagUsed.trim()
                      }
                    >
                      {submitLoading ? "Submitting…" : "Submit Post"}
                    </CDPrimaryButton>
                  </div>
                </form>
              </EditorialCard>
            )}

            {/* Giveaway entries */}
            {giveawayCampaigns.length > 0 && (
              <section className="space-y-4">
                <LabelCaps>Giveaway entries</LabelCaps>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {giveawayCampaigns.map((c) => (
                    <div
                      key={`g-${c.id}`}
                      className="p-4"
                      style={{
                        backgroundColor: "rgba(255,107,74,0.06)",
                        border: `1px solid rgba(255,107,74,0.35)`,
                        borderRadius: 10,
                      }}
                    >
                      <LabelCaps color={CD.accent}>Eligible</LabelCaps>
                      <p className="mt-1 text-sm font-semibold" style={{ color: CD.ink }}>
                        {c.name}
                      </p>
                      {c.giveawayPrize && (
                        <p className="mt-1 text-xs" style={{ color: CD.muted }}>
                          Prize: {c.giveawayPrize}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Submission history */}
            <section className="space-y-4">
              <LabelCaps>Your submissions</LabelCaps>
              {posts.length === 0 ? (
                <EditorialCard className="py-12 text-center" style={{ borderStyle: "dashed" }}>
                  <p className="text-sm" style={{ color: CD.muted }}>
                    You haven't submitted any posts yet.
                  </p>
                </EditorialCard>
              ) : (
                <EditorialCard style={{ overflow: "hidden" }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${CD.border}`, textAlign: "left" }}>
                          <th className="px-4 py-3"><LabelCaps>Submitted</LabelCaps></th>
                          <th className="px-4 py-3"><LabelCaps>Campaign</LabelCaps></th>
                          <th className="px-4 py-3"><LabelCaps>Hashtag</LabelCaps></th>
                          <th className="px-4 py-3"><LabelCaps>Post</LabelCaps></th>
                          <th className="px-4 py-3"><LabelCaps>Status</LabelCaps></th>
                        </tr>
                      </thead>
                      <tbody>
                        {posts.map((p) => (
                          <tr
                            key={p.id}
                            style={{ borderBottom: `1px solid ${CD.border}` }}
                          >
                            <td className="px-4 py-3 whitespace-nowrap">
                              <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                                {formatShortDate(p.createdAt)}
                              </Mono>
                            </td>
                            <td className="px-4 py-3 text-sm" style={{ color: CD.ink }}>
                              {p.campaignName ?? p.campaignId}
                            </td>
                            <td className="px-4 py-3">
                              <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                                #{p.hashtagUsed.replace(/^#/, "")}
                              </Mono>
                            </td>
                            <td className="px-4 py-3">
                              <a
                                href={p.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontFamily: FONT_MONO,
                                  fontSize: "0.6875rem",
                                  letterSpacing: "0.14em",
                                  textTransform: "uppercase",
                                  color: CD.accent,
                                }}
                              >
                                View →
                              </a>
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={p.status ?? "pending"} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </EditorialCard>
              )}
            </section>
          </>
        )}
      </main>
    </CDPage>
  );
}
