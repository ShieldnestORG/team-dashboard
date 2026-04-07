import { Pin, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PulseTopicCardProps {
  topic: string;
  tweetCount: number;
  avgSentiment: number | null;
  pinned?: boolean;
  onClick?: () => void;
}

const TOPIC_LABELS: Record<string, string> = {
  tx: "TX Blockchain",
  cosmos: "Cosmos Ecosystem",
  "xrpl-bridge": "XRPL Bridge",
  tokns: "tokns.fi",
  staking: "Staking",
  general: "General",
};

function sentimentIcon(score: number | null) {
  if (score === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
  if (score >= 0.6) return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (score <= 0.4) return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-yellow-500" />;
}

function sentimentPercent(score: number | null): string {
  if (score === null) return "--";
  return `${Math.round(score * 100)}%`;
}

export function PulseTopicCard({ topic, tweetCount, avgSentiment, pinned, onClick }: PulseTopicCardProps) {
  return (
    <Card
      className={`cursor-pointer hover:bg-accent/30 transition-colors ${
        pinned ? "border-blue-400 border-2 ring-1 ring-blue-400/20" : ""
      }`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {pinned && <Pin className="h-3.5 w-3.5 text-blue-400" />}
            {TOPIC_LABELS[topic] ?? topic}
          </CardTitle>
          {pinned && (
            <Badge className="bg-blue-400/10 text-blue-400 border-blue-400/30 text-[10px]">
              PINNED
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold tabular-nums">{tweetCount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">tweets (24h)</p>
          </div>
          <div className="flex items-center gap-1.5">
            {sentimentIcon(avgSentiment)}
            <span className="text-sm font-medium tabular-nums">{sentimentPercent(avgSentiment)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
