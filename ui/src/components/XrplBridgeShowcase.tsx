import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Coins, Shield, TrendingUp, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pulseApi, type XrplBridgeStats } from "../api/pulse";
import { queryKeys } from "../lib/queryKeys";
import { PulseTweetCard } from "./PulseTweetCard";

interface XrplBridgeShowcaseProps {
  compact?: boolean;
}

export function XrplBridgeShowcase({ compact = false }: XrplBridgeShowcaseProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: queryKeys.pulse.xrplBridge,
    queryFn: () => pulseApi.getXrplBridge(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading XRPL Bridge data...
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return <CompactBridgeWidget stats={stats ?? null} />;
  }

  return <FullBridgeShowcase stats={stats ?? null} />;
}

function CompactBridgeWidget({ stats }: { stats: XrplBridgeStats | null }) {
  return (
    <Card className="border-purple-400/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-purple-400" />
          XRPL Bridge
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Mentions (24h)</span>
          <span className="font-semibold tabular-nums">{stats?.totalMentions24h ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Staking Discussion</span>
          <span className="font-semibold tabular-nums">{stats?.stakingMentionPct ?? 0}%</span>
        </div>
      </CardContent>
    </Card>
  );
}

function FullBridgeShowcase({ stats }: { stats: XrplBridgeStats | null }) {
  const breakdown = stats?.bridgeTypeBreakdown ?? {};

  return (
    <div className="space-y-6">
      {/* Bridge Diagram */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-purple-900/20 to-blue-900 p-6">
          <div className="flex items-center justify-center gap-4 sm:gap-8">
            {/* XRPL Side */}
            <div className="text-center space-y-2">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-800 border-2 border-slate-600 flex items-center justify-center mx-auto">
                <Coins className="h-8 w-8 sm:h-10 sm:w-10 text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">XRP Ledger</p>
                <Badge variant="outline" className="text-[10px] border-slate-500 text-slate-300">
                  XRP
                </Badge>
              </div>
            </div>

            {/* Bridge Arrow */}
            <div className="flex flex-col items-center gap-1">
              <ArrowLeftRight className="h-6 w-6 sm:h-8 sm:w-8 text-purple-400 animate-pulse" />
              <span className="text-[10px] sm:text-xs text-purple-300 font-medium">IBC Bridge</span>
            </div>

            {/* TX Chain Side */}
            <div className="text-center space-y-2">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-blue-900 border-2 border-blue-500 flex items-center justify-center mx-auto">
                <Shield className="h-8 w-8 sm:h-10 sm:w-10 text-blue-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">TX Chain</p>
                <Badge variant="outline" className="text-[10px] border-blue-500 text-blue-300">
                  Cosmos SDK
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Promo Banner */}
        <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-t border-purple-400/20 px-6 py-4">
          <p className="text-sm text-center font-medium">
            XRP holders: hold XRP on TX chain and earn staking rewards through Cosmos IBC interoperability.
            Bridge your XRP, stake with the tokns.fi validator, and earn.
          </p>
        </div>
      </Card>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          icon={TrendingUp}
          label="Bridge Mentions (24h)"
          value={stats?.totalMentions24h ?? 0}
        />
        <MetricCard
          icon={Coins}
          label="Staking Discussion"
          value={`${stats?.stakingMentionPct ?? 0}%`}
          isText
        />
        <MetricCard
          icon={ArrowLeftRight}
          label="7-Day Volume"
          value={stats?.totalMentions7d ?? 0}
        />
      </div>

      {/* Bridge Type Breakdown */}
      {Object.keys(breakdown).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Bridge Direction Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(breakdown).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{formatBridgeType(type)}</span>
                  <Badge variant="secondary">{String(count)}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trending Bridge Tweets */}
      {stats?.trendingTweets && stats.trendingTweets.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Trending Bridge Conversations</h3>
          {stats.trendingTweets.map((tweet) => (
            <PulseTweetCard key={tweet.tweetId} tweet={tweet} />
          ))}
        </div>
      )}

      {/* CTA Buttons */}
      <div className="flex flex-wrap gap-3">
        <a
          href="https://tokns.fi"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Start Earning on tokns.fi <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href="https://tx.org"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
        >
          TX Bridge Guide <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  isText = false,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: number | string;
  isText?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className={isText ? "text-lg font-semibold" : "text-2xl font-bold tabular-nums"}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      </CardContent>
    </Card>
  );
}

function formatBridgeType(type: string): string {
  switch (type) {
    case "xrpl-to-tx": return "XRPL \u2192 TX Chain";
    case "tx-to-xrpl": return "TX Chain \u2192 XRPL";
    case "general-bridge": return "General Bridge Discussion";
    default: return type;
  }
}
