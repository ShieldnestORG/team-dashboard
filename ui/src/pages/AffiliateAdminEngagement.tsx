import { useEffect, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Hash, ExternalLink } from "lucide-react";
import {
  affiliatesAdminApi,
  type AdminEngagementPost,
} from "@/api/affiliates-admin";
import { AffiliateAdminTabs } from "@/components/AffiliateAdminTabs";

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface Draft {
  score: number;
  giveawayEligible: boolean;
  saving: boolean;
  error: string | null;
}

export function AffiliateAdminEngagement() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [posts, setPosts] = useState<AdminEngagementPost[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Affiliates", href: "/affiliates" }, { label: "Engagement" }]);
  }, [setBreadcrumbs]);

  async function refresh() {
    const res = await affiliatesAdminApi.listEngagementPosts("unscored");
    setPosts(res);
    const next: Record<string, Draft> = {};
    for (const p of res) {
      next[p.id] = {
        score: p.score,
        giveawayEligible: p.giveawayEligible,
        saving: false,
        error: null,
      };
    }
    setDrafts(next);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load posts"))
      .finally(() => setLoading(false));
  }, []);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(post: AdminEngagementPost) {
    const draft = drafts[post.id];
    if (!draft) return;
    const score = Math.max(0, Math.min(100, Number.isFinite(draft.score) ? draft.score : 0));
    updateDraft(post.id, { saving: true, error: null });
    try {
      await affiliatesAdminApi.scoreEngagementPost(post.id, score, draft.giveawayEligible);
      // Remove from unscored list by refreshing
      await refresh();
    } catch (err) {
      updateDraft(post.id, {
        saving: false,
        error: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  if (loading && posts.length === 0) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Engagement</h1>
        <p className="text-sm text-muted-foreground">
          Score affiliate posts and mark giveaway eligibility for active campaigns.
        </p>
      </div>

      <AffiliateAdminTabs active="engagement" />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {posts.length === 0 && !loading ? (
        <EmptyState
          icon={Hash}
          message="No unscored posts. New posts will appear here when affiliates tag active campaigns."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Affiliate</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Campaign</th>
                  <th className="px-4 py-3 font-medium">Post</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Hashtag</th>
                  <th className="px-4 py-3 font-medium text-right">Score</th>
                  <th className="px-4 py-3 font-medium text-center">Giveaway</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => {
                  const d = drafts[p.id] ?? {
                    score: p.score,
                    giveawayEligible: p.giveawayEligible,
                    saving: false,
                    error: null,
                  };
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatShortDate(p.occurredAt)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        {p.affiliateName}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                        {p.campaignName ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={p.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#ff876d] hover:underline"
                        >
                          View
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-xs text-muted-foreground font-mono">
                        {p.hashtagUsed || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={d.score}
                          onChange={(e) => updateDraft(p.id, { score: parseInt(e.target.value, 10) || 0 })}
                          disabled={d.saving}
                          className="w-20 rounded-md border border-border bg-card px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-[#ff876d] disabled:opacity-60"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={d.giveawayEligible}
                          onChange={(e) => updateDraft(p.id, { giveawayEligible: e.target.checked })}
                          disabled={d.saving}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSave(p)}
                            disabled={d.saving}
                            className="text-xs h-7 border-[#ff876d]/40 text-[#ff876d] hover:bg-[#ff876d]/10"
                          >
                            {d.saving ? "Saving…" : "Save"}
                          </Button>
                          {d.error && (
                            <span className="text-[10px] text-destructive">{d.error}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
