import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useLocation } from "@/lib/router";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { PageTabBar } from "../components/PageTabBar";
import { PulseTweetCard } from "../components/PulseTweetCard";
import { PulseTopicCard } from "../components/PulseTopicCard";
import { XrplBridgeShowcase } from "../components/XrplBridgeShowcase";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import {
  pulseApi,
  type PulseSummary,
  type PulseTweetData,
  type PulseTopicBreakdown,
} from "../api/pulse";
import {
  Radio,
  TrendingUp,
  ArrowLeftRight,
  BarChart3,
  MessageCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { HowToGuide } from "../components/HowToGuide";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type PulseTab = "overview" | "tx" | "xrpl-bridge" | "cosmos" | "all";

const TAB_ITEMS: { value: PulseTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "tx", label: "TX Feed" },
  { value: "xrpl-bridge", label: "XRPL Bridge" },
  { value: "cosmos", label: "Cosmos" },
  { value: "all", label: "All Tweets" },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SocialPulse() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();

  const pathSegment = location.pathname.split("/").pop() ?? "overview";
  const tab: PulseTab = TAB_ITEMS.some((t) => t.value === pathSegment)
    ? (pathSegment as PulseTab)
    : "overview";

  useEffect(() => {
    setBreadcrumbs([{ label: "Social Pulse" }]);
  }, [setBreadcrumbs]);

  // ── Queries ─────────────────────────────────────────────────────────

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: queryKeys.pulse.summary(24),
    queryFn: () => pulseApi.getSummary(24),
    refetchInterval: 60_000, // refresh every minute
  });

  const { data: topics } = useQuery({
    queryKey: queryKeys.pulse.topics,
    queryFn: () => pulseApi.getTopics(),
    refetchInterval: 60_000,
  });

  const { data: trending } = useQuery({
    queryKey: queryKeys.pulse.trending(),
    queryFn: () => pulseApi.getTrendingTweets(undefined, 10),
    enabled: tab === "overview",
  });

  // ── Tab-specific tweet queries ──────────────────────────────────────

  const topicFilter = tab === "all" ? undefined : tab === "overview" ? undefined : tab;

  const { data: tweetData, isLoading: tweetsLoading } = useQuery({
    queryKey: queryKeys.pulse.tweets(topicFilter, 1),
    queryFn: () => pulseApi.getTweets({ topic: topicFilter, limit: 30 }),
    enabled: tab !== "overview" && tab !== "xrpl-bridge",
  });

  // ── Render ──────────────────────────────────────────────────────────

  if (summaryLoading && tab === "overview") {
    return <PageSkeleton variant="dashboard" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={tab}
          onValueChange={(v) =>
            navigate(v === "overview" ? "/social-pulse" : `/social-pulse/${v}`)
          }
        >
          <PageTabBar
            items={TAB_ITEMS}
            value={tab}
            onValueChange={(v) =>
              navigate(v === "overview" ? "/social-pulse" : `/social-pulse/${v}`)
            }
          />
        </Tabs>
      </div>

      <HowToGuide
        sections={[
          {
            heading: "What This Page Shows",
            steps: [
              { title: "Real-time X/Twitter monitoring", description: "We automatically track tweets about TX Blockchain, Cosmos, XRPL Bridge, and Tokns every 5 minutes." },
              { title: "Sentiment scoring", description: "Each tweet is scored 0-1 for positive/negative sentiment so you can spot shifts in community mood." },
              { title: "Volume spikes", description: "When tweet volume jumps significantly, you'll see spike alerts — great for catching viral moments." },
            ],
          },
          {
            heading: "Using the Tabs",
            steps: [
              { title: "Overview", description: "High-level stats — total tweets, sentiment averages, and topic breakdowns at a glance." },
              { title: "TX / Cosmos / XRPL Bridge feeds", description: "Click a topic tab to see that topic's tweet feed with the most engaging posts first." },
              { title: "All Tweets", description: "Unfiltered chronological feed of everything we're tracking." },
            ],
          },
          {
            heading: "Tips",
            steps: [
              { title: "Check after announcements", description: "After any TX or Cosmos announcement, check here to see how the community reacted." },
              { title: "Use for content ideas", description: "Trending tweets and hot topics make great starting points for new content in the Content Studio." },
            ],
          },
        ]}
      />

      {tab === "overview" && (
        <OverviewPanel
          summary={summary ?? null}
          topics={topics?.topics ?? []}
          trending={trending?.tweets ?? []}
          onTopicClick={(t) => navigate(`/social-pulse/${t}`)}
        />
      )}

      {tab === "xrpl-bridge" && <XrplBridgeShowcase />}

      {(tab === "tx" || tab === "cosmos" || tab === "all") && (
        <TweetFeedPanel
          tweets={tweetData?.tweets ?? []}
          loading={tweetsLoading}
          topic={topicFilter}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview Panel
// ---------------------------------------------------------------------------

function OverviewPanel({
  summary,
  topics,
  trending,
  onTopicClick,
}: {
  summary: PulseSummary | null;
  topics: PulseTopicBreakdown[];
  trending: PulseTweetData[];
  onTopicClick: (topic: string) => void;
}) {
  // Separate TX from other topics (TX always first)
  const txTopic = topics.find((t) => t.topic === "tx");
  const otherTopics = topics.filter((t) => t.topic !== "tx");

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={MessageCircle}
          label="Total Tweets (24h)"
          value={summary?.totalTweets24h ?? 0}
        />
        <StatCard
          icon={TrendingUp}
          label="Overall Sentiment"
          value={summary ? `${Math.round(summary.overallSentiment * 100)}%` : "--"}
          isText
        />
        <StatCard
          icon={ArrowLeftRight}
          label="XRPL Bridge Mentions"
          value={summary?.xrplBridgeMentions24h ?? 0}
        />
        <StatCard
          icon={BarChart3}
          label="Topics Tracked"
          value={topics.length}
        />
      </div>

      {/* TX Pinned Card — always first */}
      {txTopic && (
        <div>
          <PulseTopicCard
            topic={txTopic.topic}
            tweetCount={txTopic.tweetCount}
            avgSentiment={txTopic.avgSentiment}
            pinned
            onClick={() => onTopicClick("tx")}
          />
        </div>
      )}

      {/* Other Topics Grid */}
      {otherTopics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {otherTopics.map((t) => (
            <PulseTopicCard
              key={t.topic}
              topic={t.topic}
              tweetCount={t.tweetCount}
              avgSentiment={t.avgSentiment}
              onClick={() => onTopicClick(t.topic)}
            />
          ))}
        </div>
      )}

      {/* Trending Tweets */}
      {trending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Trending Tweets
          </h3>
          <div className="space-y-3">
            {trending.slice(0, 5).map((tweet) => (
              <PulseTweetCard key={tweet.tweetId} tweet={tweet} />
            ))}
          </div>
        </div>
      )}

      {/* XRPL Bridge Compact */}
      <XrplBridgeShowcase compact />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tweet Feed Panel
// ---------------------------------------------------------------------------

function TweetFeedPanel({
  tweets,
  loading,
  topic,
}: {
  tweets: PulseTweetData[];
  loading: boolean;
  topic?: string;
}) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? tweets.filter(
        (t) =>
          t.text.toLowerCase().includes(search.toLowerCase()) ||
          t.authorUsername.toLowerCase().includes(search.toLowerCase()),
      )
    : tweets;

  if (loading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tweets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {filtered.length} tweet{filtered.length !== 1 ? "s" : ""}
          {topic && <> in <Badge variant="outline" className="ml-1 text-[10px]">{topic}</Badge></>}
        </p>
      </div>

      {filtered.length === 0 && (
        <EmptyState icon={Radio} message="No tweets found." />
      )}

      <div className="space-y-3">
        {filtered.map((tweet) => (
          <PulseTweetCard key={tweet.tweetId} tweet={tweet} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
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
