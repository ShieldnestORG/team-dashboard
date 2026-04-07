import { useState, useEffect } from "react";

interface WidgetData {
  tx: { tweets24h: number; sentiment: number; topTweet: TopTweet | null };
  xrplBridge: { mentions24h: number; stakingPct: number };
  overall: { tweets24h: number; sentiment: number };
  updatedAt: string;
}

interface TopTweet {
  tweetId: string;
  authorUsername: string;
  authorName: string | null;
  text: string;
}

interface SocialPulseWidgetEmbedProps {
  apiBaseUrl?: string;
}

const DEFAULT_API = "https://31.220.61.12:3200";
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

function sentimentColor(score: number): string {
  if (score >= 0.6) return "#22c55e"; // green-500
  if (score <= 0.4) return "#ef4444"; // red-500
  return "#eab308"; // yellow-500
}

function sentimentLabel(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function SocialPulseWidgetEmbed({
  apiBaseUrl,
}: SocialPulseWidgetEmbedProps) {
  const [data, setData] = useState<WidgetData | null>(null);
  const [error, setError] = useState(false);

  const base = (apiBaseUrl ?? DEFAULT_API).replace(/\/$/, "");

  useEffect(() => {
    let active = true;

    async function fetchWidget() {
      try {
        const res = await fetch(`${base}/api/public/pulse/widget`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: WidgetData = await res.json();
        if (active) {
          setData(json);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }

    fetchWidget();
    const interval = setInterval(fetchWidget, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [base]);

  if (error && !data) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400 w-[300px]">
        Social Pulse unavailable
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-center text-sm text-zinc-400 w-[300px]">
        Loading Social Pulse...
      </div>
    );
  }

  const sentColor = sentimentColor(data.overall.sentiment);

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-zinc-900 p-4 w-[300px] space-y-3 font-sans text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 text-cyan-400 font-medium">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
          <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4" />
          <circle cx="12" cy="12" r="2" />
          <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4" />
          <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
        </svg>
        Social Pulse
      </div>

      {/* Metrics */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">TX Tweets (24h)</span>
          <span className="font-semibold text-zinc-100 tabular-nums">
            {data.tx.tweets24h.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Sentiment</span>
          <span className="font-semibold tabular-nums" style={{ color: sentColor }}>
            {sentimentLabel(data.overall.sentiment)}
          </span>
        </div>

        {/* Sentiment bar */}
        <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.round(data.overall.sentiment * 100)}%`,
              backgroundColor: sentColor,
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-zinc-400">XRPL Bridge</span>
          <span className="font-semibold text-zinc-100 tabular-nums">
            {data.xrplBridge.mentions24h} mentions
          </span>
        </div>
      </div>

      {/* Top tweet preview */}
      {data.tx.topTweet && (
        <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2.5 text-xs text-zinc-300 space-y-1">
          <div className="font-medium text-zinc-100">
            @{data.tx.topTweet.authorUsername}
          </div>
          <div className="line-clamp-2 leading-relaxed">
            {data.tx.topTweet.text}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-zinc-500 text-right">
        Updated {new Date(data.updatedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}
