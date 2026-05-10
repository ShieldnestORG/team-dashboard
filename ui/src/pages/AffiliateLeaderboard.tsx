import { useEffect, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  type LeaderboardPeriod,
  type LeaderboardResponse,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";
import { CDPage, EditorialCard, LabelCaps, Mono } from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

function formatScore(score: number): string {
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
    <CDPage>
      <AffiliateNav active="/leaderboard" subtitle="Affiliate" title="Leaderboard" />

      <main className="mx-auto w-full max-w-[1200px] px-6 py-10 space-y-6">
        {/* Period toggle */}
        <div className="flex flex-wrap gap-2">
          {PERIOD_OPTIONS.map((opt) => {
            const active = period === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPeriod(opt.value)}
                className="inline-flex items-center px-3 py-1.5 transition-colors"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  borderRadius: 9999,
                  backgroundColor: active ? "rgba(255,107,74,0.10)" : "transparent",
                  color: active ? CD.accent : CD.muted,
                  border: `1px solid ${active ? "rgba(255,107,74,0.40)" : CD.border}`,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = CD.ink; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = CD.muted; }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* My rank — only when not in top */}
        {me && !meInTop && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            style={{
              backgroundColor: "rgba(255,107,74,0.06)",
              border: `1px solid rgba(255,107,74,0.35)`,
              borderRadius: 12,
            }}
          >
            <div>
              <LabelCaps color={CD.accent}>Your rank</LabelCaps>
              <p className="mt-1">
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "1.5rem",
                    fontWeight: 600,
                    color: CD.ink,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  #{me.rank}
                </span>
                <Mono style={{ marginLeft: 12, color: CD.muted, fontSize: "0.875rem" }}>
                  · {formatScore(me.score)}
                </Mono>
              </p>
            </div>
            <p className="max-w-[50%] text-right text-xs" style={{ color: CD.muted }}>
              Keep converting leads to climb into the top 20.
            </p>
          </div>
        )}

        {loading ? (
          <EditorialCard className="py-12 text-center">
            <LabelCaps>Loading leaderboard…</LabelCaps>
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
        ) : top.length === 0 ? (
          <EditorialCard className="py-16 text-center" style={{ borderStyle: "dashed" }}>
            <LabelCaps color={CD.accent}>The board is empty</LabelCaps>
            <p className="mt-3 text-sm" style={{ color: CD.muted }}>
              Be the first on the board.
            </p>
          </EditorialCard>
        ) : (
          <EditorialCard style={{ overflow: "hidden" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${CD.border}`, textAlign: "left" }}>
                    <th className="px-4 py-3 w-20"><LabelCaps>Rank</LabelCaps></th>
                    <th className="px-4 py-3"><LabelCaps>Affiliate</LabelCaps></th>
                    <th className="px-4 py-3 text-right"><LabelCaps>Score</LabelCaps></th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row) => {
                    const isMe = me?.rank === row.rank;
                    return (
                      <tr
                        key={`${row.rank}-${row.affiliateId}`}
                        style={{
                          borderBottom: `1px solid ${CD.border}`,
                          backgroundColor: isMe ? "rgba(255,107,74,0.06)" : "transparent",
                        }}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Mono style={{ color: isMe ? CD.accent : CD.ink, fontWeight: 600 }}>
                            #{row.rank}
                          </Mono>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-sm font-medium"
                            style={{ color: isMe ? CD.accent : CD.ink }}
                          >
                            {row.name}
                            {isMe && (
                              <span
                                className="ml-2"
                                style={{
                                  fontFamily: FONT_MONO,
                                  fontSize: "0.625rem",
                                  letterSpacing: "0.14em",
                                  textTransform: "uppercase",
                                  color: CD.accent,
                                  backgroundColor: "rgba(255,107,74,0.12)",
                                  border: `1px solid rgba(255,107,74,0.40)`,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  verticalAlign: "middle",
                                }}
                              >
                                You
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Mono style={{ color: CD.ink, fontWeight: 600 }}>
                            {formatScore(row.score)}
                          </Mono>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </EditorialCard>
        )}
      </main>
    </CDPage>
  );
}
