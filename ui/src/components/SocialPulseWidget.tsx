import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Radio, TrendingUp, TrendingDown, Minus, ArrowLeftRight, MessageCircle } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { pulseApi } from "@/api/pulse";

function sentimentColor(score: number): string {
  if (score >= 0.6) return "text-green-500";
  if (score <= 0.4) return "text-red-500";
  return "text-yellow-500";
}

function sentimentIcon(score: number) {
  if (score >= 0.6) return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (score <= 0.4) return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-yellow-500" />;
}

export function SocialPulseWidget() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.pulse.summary(),
    queryFn: () => pulseApi.getSummary(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading Social Pulse...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-cyan-400/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Radio className="h-4 w-4 text-cyan-400" />
          Social Pulse
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <MessageCircle className="h-3.5 w-3.5" />
            Tweets (24h)
          </span>
          <span className="font-semibold tabular-nums">
            {(data?.totalTweets24h ?? 0).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            {sentimentIcon(data?.overallSentiment ?? 0.5)}
            Sentiment
          </span>
          <span className={`font-semibold tabular-nums ${sentimentColor(data?.overallSentiment ?? 0.5)}`}>
            {Math.round((data?.overallSentiment ?? 0) * 100)}%
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            XRPL Bridge
          </span>
          <span className="font-semibold tabular-nums">
            {(data?.xrplBridgeMentions24h ?? 0).toLocaleString()} mentions
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            Topics tracked
          </span>
          <span className="font-semibold tabular-nums">
            {data?.topics?.length ?? 0}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
