import { useEffect, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type LeaderboardPeriod,
  type LeaderboardResponse,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";

function formatScore(score: number): string {
  // Score is commission cents or points depending on period — render both as a
  // compact dollar-ish figure for readability.
  const dollars = (score || 0) / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

const PERIOD_OPTIONS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "month", label: "This Month" },
  { value: "all_time", label: "All Time" },
];

export function AffiliateLeaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("month");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }
    setLoading(true);
    setError(null);
    affiliatesApi
      .getLeaderboard(period)
      .then((res) => setData(res))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load leaderboard"),
      )
      .finally(() => setLoading(false));
  }, [period]);

  const top = data?.top ?? [];
  const me = data?.me ?? null;
  const meInTop = me && top.some((r) => r.rank === me.rank);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AffiliateNav
        active="/leaderboard"
        subtitle="Affiliate Program"
        title="Leaderboard"
      />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-5">
        {/* Period toggle */}
        <div className="flex flex-wrap gap-2">
          {PERIOD_OPTIONS.map((opt) => {
            const active = period === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPeriod(opt.value)}
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/40"
                    : "bg-card text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {me && !meInTop && (
          <div className="rounded-xl border border-[#ff876d]/40 bg-[#ff876d]/10 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[#ff876d] font-semibold">
                Your rank
              </p>
              <p className="text-lg font-bold text-foreground">
                #{me.rank}
                <span className="ml-2 text-sm text-muted-foreground font-normal">
                  · {formatScore(me.score)}
                </span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground text-right max-w-[50%]">
              Keep converting leads to climb into the top 20.
            </p>
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <p className="text-muted-foreground text-sm">Loading…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : top.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No leaderboard activity yet. Be the first on the board.
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium w-20">Rank</th>
                    <th className="px-4 py-3 font-medium">Affiliate</th>
                    <th className="px-4 py-3 font-medium text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row) => {
                    const isMe = me?.rank === row.rank;
                    return (
                      <tr
                        key={`${row.rank}-${row.affiliateId}`}
                        className={`border-b border-border last:border-0 transition-colors ${
                          isMe
                            ? "bg-[#ff876d]/10"
                            : "hover:bg-background"
                        }`}
                      >
                        <td className="px-4 py-3 text-sm font-semibold text-foreground whitespace-nowrap">
                          #{row.rank}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-sm font-medium ${
                              isMe ? "text-[#ff876d]" : "text-foreground"
                            }`}
                          >
                            {row.name}
                            {isMe && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ff876d]/20 text-[#ff876d] border border-[#ff876d]/40 align-middle">
                                You
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                          {formatScore(row.score)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
