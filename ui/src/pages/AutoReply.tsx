import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  autoReplyApi,
  type AutoReplyConfig,
  type AutoReplyLogEntry,
} from "../api/auto-reply";
import {
  Reply,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Clock,
  Zap,
  AlertCircle,
  CheckCircle,
  XCircle,
  Activity,
  Wifi,
  WifiOff,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Add Target Form
// ---------------------------------------------------------------------------

function AddTargetForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"template" | "ai">("template");
  const [templates, setTemplates] = useState(
    "Great insight! The TX ecosystem keeps building.\nExciting to see this! Bullish on what is coming.\nThis is huge for the community! Keep shipping.\nLove where this is heading. TX ecosystem is on fire.\nReally solid update here. The future looks bright.",
  );
  const [aiPrompt, setAiPrompt] = useState(
    "You are a knowledgeable crypto enthusiast who follows TX Blockchain. Write a brief, engaging reply (under 280 chars) to this tweet. Be authentic, add value, avoid sounding like a bot.",
  );

  const isKeyword = target.trim().startsWith("#") || (!target.trim().startsWith("@") && target.trim().length > 0);
  const isAccount = target.trim().startsWith("@");

  const createMutation = useMutation({
    mutationFn: () =>
      autoReplyApi.createConfig({
        target: target.trim(),
        replyMode: mode,
        replyTemplates: mode === "template" ? templates.split("\n").filter(Boolean) : undefined,
        aiPrompt: mode === "ai" ? aiPrompt : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autoReply.configs });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add Auto-Reply Target</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Target (@ for accounts, # for hashtags, or any keyword)
          </label>
          <Input
            placeholder="@txEcosystem, #TXblockchain, or tokns.fi"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="text-base"
          />
          <div className="mt-1 text-xs text-muted-foreground">
            {isAccount && "Account target \u2014 will reply to tweets from this user"}
            {isKeyword && "Keyword target \u2014 will reply to tweets containing this term"}
            {!target.trim() && "Type @username to watch an account, or #hashtag / keyword to match tweet text"}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Reply Mode</label>
          <div className="mt-1 flex gap-2">
            <Button
              size="sm"
              variant={mode === "template" ? "default" : "outline"}
              onClick={() => setMode("template")}
            >
              Templates
            </Button>
            <Button
              size="sm"
              variant={mode === "ai" ? "default" : "outline"}
              onClick={() => setMode("ai")}
            >
              AI (Ollama)
            </Button>
          </div>
        </div>

        {mode === "template" ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Reply Templates (one per line)
            </label>
            <textarea
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              rows={4}
              value={templates}
              onChange={(e) => setTemplates(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-muted-foreground">AI System Prompt</label>
            <textarea
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              rows={3}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!target.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Adding..." : "Add Target"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Config Card
// ---------------------------------------------------------------------------

function ConfigCard({ config }: { config: AutoReplyConfig }) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: () => autoReplyApi.toggleConfig(config.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autoReply.configs });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => autoReplyApi.deleteConfig(config.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autoReply.configs });
    },
  });

  return (
    <Card className={!config.enabled ? "opacity-60" : ""}>
      <CardContent className="flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleMutation.mutate()}
            className="text-muted-foreground hover:text-foreground"
          >
            {config.enabled ? (
              <ToggleRight className="h-5 w-5 text-green-500" />
            ) : (
              <ToggleLeft className="h-5 w-5" />
            )}
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {config.targetType === "keyword" ? config.targetXUsername : `@${config.targetXUsername}`}
              </span>
              <Badge variant={config.targetType === "keyword" ? "default" : "outline"} className="text-xs">
                {config.targetType === "keyword" ? "keyword" : "account"}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {config.replyMode}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {config.maxRepliesPerDay}/day
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {config.targetXUserId ? `ID: ${config.targetXUserId} | ` : ""}Delay: {config.minDelaySeconds}-{config.maxDelaySeconds}s
            </div>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          onClick={() => {
            if (confirm(`Delete auto-reply target @${config.targetXUsername}?`)) {
              deleteMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Log Entry Row
// ---------------------------------------------------------------------------

function LogRow({ entry }: { entry: AutoReplyLogEntry }) {
  const statusIcon = {
    sent: <CheckCircle className="h-4 w-4 text-green-500" />,
    failed: <XCircle className="h-4 w-4 text-red-500" />,
    rate_limited: <AlertCircle className="h-4 w-4 text-yellow-500" />,
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  }[entry.status] ?? <Clock className="h-4 w-4" />;

  return (
    <div className="flex items-start gap-3 border-b py-2 last:border-0">
      {statusIcon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">@{entry.sourceAuthorUsername}</span>
          <Badge variant="outline" className="text-xs">
            {entry.source}
          </Badge>
          {entry.latencyMs != null && (
            <span className="text-xs text-muted-foreground">{entry.latencyMs}ms</span>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">{entry.replyText}</p>
        {entry.error && <p className="text-xs text-red-400">{entry.error}</p>}
        <span className="text-xs text-muted-foreground">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics Card
// ---------------------------------------------------------------------------

function DiagnosticsCard() {
  const { data } = useQuery({
    queryKey: queryKeys.pulse.diagnostics,
    queryFn: () => autoReplyApi.getDiagnostics(),
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const { stream, tweetCounts } = data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />
          Pulse System Health
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border p-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {stream.connected ? (
              <Wifi className="h-3 w-3 text-green-500" />
            ) : (
              <WifiOff className="h-3 w-3 text-red-500" />
            )}
            Stream
          </div>
          <div className="text-sm font-medium">
            {stream.connected ? "Connected" : stream.fallbackToPolling ? "Polling Fallback" : "Disconnected"}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Bearer Token</div>
          <div className="text-sm font-medium">
            {stream.bearerTokenPresent ? (
              <span className="text-green-500">Set</span>
            ) : (
              <span className="text-red-500">Missing</span>
            )}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Tweets (1h / 24h)</div>
          <div className="text-sm font-medium">
            {tweetCounts.lastHour} / {tweetCounts.last24h}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Tweets/min</div>
          <div className="text-sm font-medium">{stream.tweetsPerMinute}</div>
        </div>
        {stream.lastError && (
          <div className="col-span-full rounded-md border border-red-500/30 bg-red-500/10 p-2">
            <div className="text-xs text-red-400">Last Error: {stream.lastError}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function AutoReply() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [showAdd, setShowAdd] = useState(false);
  const [logPage, setLogPage] = useState(1);

  useEffect(() => {
    setBreadcrumbs([{ label: "Social Pulse", href: "/social-pulse" }, { label: "Auto-Reply" }]);
  }, [setBreadcrumbs]);

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: queryKeys.autoReply.configs,
    queryFn: () => autoReplyApi.listConfigs(),
  });

  const { data: statsData } = useQuery({
    queryKey: queryKeys.autoReply.stats,
    queryFn: () => autoReplyApi.getStats(),
    refetchInterval: 30_000,
  });

  const { data: logData } = useQuery({
    queryKey: queryKeys.autoReply.log(logPage),
    queryFn: () => autoReplyApi.getLog(logPage, 15),
    refetchInterval: 15_000,
  });

  if (configLoading) return <PageSkeleton variant="list" />;

  const configs = configData?.configs ?? [];
  const stats = statsData;
  const logEntries = logData?.log ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Reply className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Auto-Reply</h1>
          <Badge variant="secondary">{configs.length} targets</Badge>
        </div>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Target
        </Button>
      </div>

      {/* Diagnostics */}
      <DiagnosticsCard />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-green-500">{stats.todaySent}</div>
              <div className="text-xs text-muted-foreground">Sent Today</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-red-500">{stats.todayFailed}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold">
                {stats.avgLatencyMs > 0 ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s` : "--"}
              </div>
              <div className="text-xs text-muted-foreground">Avg Latency</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-bold">
                {stats.globalBudget.repliesLimit - stats.globalBudget.repliesUsed}
              </div>
              <div className="text-xs text-muted-foreground">
                Replies Left ({stats.globalBudget.repliesUsed}/{stats.globalBudget.repliesLimit})
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Target Form */}
      {showAdd && <AddTargetForm onDone={() => setShowAdd(false)} />}

      {/* Configs */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Targets</h2>
        {configs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No auto-reply targets configured. Click "Add Target" to start.
            </CardContent>
          </Card>
        ) : (
          configs.map((c) => <ConfigCard key={c.id} config={c} />)
        )}
      </div>

      {/* Reply Log */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Zap className="h-4 w-4" />
            Reply Log
          </h2>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={logPage <= 1}
              onClick={() => setLogPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={logEntries.length < 15}
              onClick={() => setLogPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
        <Card>
          <CardContent className="py-2">
            {logEntries.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No auto-replies yet. Waiting for target accounts to tweet...
              </div>
            ) : (
              logEntries.map((entry) => <LogRow key={entry.id} entry={entry} />)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
