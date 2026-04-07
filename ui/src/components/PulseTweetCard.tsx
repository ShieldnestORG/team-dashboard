import { Heart, Repeat2, MessageCircle, Eye, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PulseTweetData } from "../api/pulse";

function sentimentLabel(score: number | null): { text: string; className: string } {
  if (score === null) return { text: "Unscored", className: "text-muted-foreground" };
  if (score >= 0.65) return { text: "Positive", className: "text-green-500" };
  if (score <= 0.35) return { text: "Negative", className: "text-red-500" };
  return { text: "Neutral", className: "text-yellow-500" };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function PulseTweetCard({ tweet }: { tweet: PulseTweetData }) {
  const sentiment = sentimentLabel(tweet.sentimentScore);

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm truncate">
            {tweet.authorName ?? tweet.authorUsername}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            @{tweet.authorUsername}
          </span>
          <span className="text-xs text-muted-foreground">{timeAgo(tweet.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-[10px]">{tweet.topic}</Badge>
          <span className={`text-[10px] font-medium ${sentiment.className}`}>{sentiment.text}</span>
        </div>
      </div>

      <p className="text-sm leading-relaxed">{tweet.text}</p>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Heart className="h-3 w-3" /> {tweet.metrics.likes.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <Repeat2 className="h-3 w-3" /> {tweet.metrics.retweets.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="h-3 w-3" /> {tweet.metrics.replies.toLocaleString()}
        </span>
        {tweet.metrics.impressions > 0 && (
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" /> {tweet.metrics.impressions.toLocaleString()}
          </span>
        )}
        <a
          href={`https://x.com/${tweet.authorUsername}/status/${tweet.tweetId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" /> View
        </a>
      </div>
    </div>
  );
}
