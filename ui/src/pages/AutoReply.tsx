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
  type AutoReplyGlobalSettings,
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
  Settings,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Pencil,
  X,
  Save,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Settings Panel
// ---------------------------------------------------------------------------

function SettingsPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["auto-reply", "settings"],
    queryFn: () => autoReplyApi.getSettings(),
  });

  const settings = data?.settings;
  const [form, setForm] = useState<Partial<AutoReplyGlobalSettings>>({});

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (updates: Partial<AutoReplyGlobalSettings>) => autoReplyApi.updateSettings(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auto-reply", "settings"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.autoReply.stats });
    },
  });

  if (!settings) return null;

  return (
    <Card>
      <CardHeader
        className="cursor-pointer py-3"
        onClick={() => setOpen(!open)}
      >
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings className="h-4 w-4" />
          Global Settings
          {open ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
          {!settings.enabled && <Badge variant="destructive" className="ml-2 text-xs">Disabled</Badge>}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Enabled</label>
              <div className="mt-1">
                <Button
                  size="sm"
                  variant={form.enabled ? "default" : "outline"}
                  onClick={() => {
                    const updated = { ...form, enabled: !form.enabled };
                    setForm(updated);
                    saveMutation.mutate({ enabled: updated.enabled });
                  }}
                >
                  {form.enabled ? "Active" : "Paused"}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Poll Interval</label>
              <select
                className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.pollIntervalMinutes ?? 30}
                onChange={(e) => setForm({ ...form, pollIntervalMinutes: parseInt(e.target.value) })}
              >
                <option value={5}>5 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Daily Spend Cap ($)</label>
              <Input
                type="number"
                step="0.25"
                min="0.10"
                max="50"
                className="mt-1"
                value={form.dailySpendCapUsd ?? 1}
                onChange={(e) => setForm({ ...form, dailySpendCapUsd: parseFloat(e.target.value) })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Max Replies/Day</label>
              <Input
                type="number"
                min="1"
                max="500"
                className="mt-1"
                value={form.globalMaxRepliesPerDay ?? 50}
                onChange={(e) => setForm({ ...form, globalMaxRepliesPerDay: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Default Delay (sec)</label>
              <div className="mt-1 flex gap-2">
                <Input
                  type="number"
                  min="1"
                  max="120"
                  placeholder="Min"
                  value={form.defaultMinDelaySeconds ?? 3}
                  onChange={(e) => setForm({ ...form, defaultMinDelaySeconds: parseInt(e.target.value) })}
                />
                <Input
                  type="number"
                  min="1"
                  max="120"
                  placeholder="Max"
                  value={form.defaultMaxDelaySeconds ?? 15}
                  onChange={(e) => setForm({ ...form, defaultMaxDelaySeconds: parseInt(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Default Max/Target</label>
              <Input
                type="number"
                min="1"
                max="100"
                className="mt-1"
                value={form.defaultMaxRepliesPerTarget ?? 10}
                onChange={(e) => setForm({ ...form, defaultMaxRepliesPerTarget: parseInt(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
            >
              <Save className="mr-1 h-3 w-3" />
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

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
            <Button size="sm" variant={mode === "template" ? "default" : "outline"} onClick={() => setMode("template")}>
              Templates
            </Button>
            <Button size="sm" variant={mode === "ai" ? "default" : "outline"} onClick={() => setMode("ai")}>
              AI (Ollama)
            </Button>
          </div>
        </div>

        {mode === "template" ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reply Templates (one per line)</label>
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
          <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
          <Button size="sm" onClick={() => createMutation.mutate()} disabled={!target.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Adding..." : "Add Target"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Config Card (with inline editing)
// ---------------------------------------------------------------------------

function ConfigCard({ config }: { config: AutoReplyConfig }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    replyMode: config.replyMode,
    replyTemplates: config.replyTemplates?.join("\n") ?? "",
    aiPrompt: config.aiPrompt ?? "",
    maxRepliesPerDay: config.maxRepliesPerDay,
    minDelaySeconds: config.minDelaySeconds,
    maxDelaySeconds: config.maxDelaySeconds,
  });

  const toggleMutation = useMutation({
    mutationFn: () => autoReplyApi.toggleConfig(config.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.autoReply.configs }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => autoReplyApi.deleteConfig(config.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.autoReply.configs }),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      autoReplyApi.updateConfig(config.id, {
        replyMode: form.replyMode,
        replyTemplates: form.replyMode === "template" ? form.replyTemplates.split("\n").filter(Boolean) : config.replyTemplates,
        aiPrompt: form.replyMode === "ai" ? form.aiPrompt : config.aiPrompt,
        maxRepliesPerDay: form.maxRepliesPerDay,
        minDelaySeconds: form.minDelaySeconds,
        maxDelaySeconds: form.maxDelaySeconds,
      } as Partial<AutoReplyConfig>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autoReply.configs });
      setEditing(false);
    },
  });

  return (
    <Card className={!config.enabled ? "opacity-60" : ""}>
      <CardContent className="py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => toggleMutation.mutate()} className="text-muted-foreground hover:text-foreground">
              {config.enabled ? <ToggleRight className="h-5 w-5 text-green-500" /> : <ToggleLeft className="h-5 w-5" />}
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {config.targetType === "keyword" ? config.targetXUsername : `@${config.targetXUsername}`}
                </span>
                <Badge variant={config.targetType === "keyword" ? "default" : "outline"} className="text-xs">
                  {config.targetType === "keyword" ? "keyword" : "account"}
                </Badge>
                <Badge variant="outline" className="text-xs">{config.replyMode}</Badge>
                <Badge variant="secondary" className="text-xs">{config.maxRepliesPerDay}/day</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {config.targetXUserId ? `ID: ${config.targetXUserId} | ` : ""}Delay: {config.minDelaySeconds}-{config.maxDelaySeconds}s
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(!editing)}>
              {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive"
              onClick={() => {
                if (confirm(`Delete auto-reply target @${config.targetXUsername}?`)) deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {editing && (
          <div className="mt-3 space-y-3 border-t pt-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Reply Mode</label>
                <div className="mt-1 flex gap-1">
                  <Button size="sm" variant={form.replyMode === "template" ? "default" : "outline"} onClick={() => setForm({ ...form, replyMode: "template" })}>
                    Templates
                  </Button>
                  <Button size="sm" variant={form.replyMode === "ai" ? "default" : "outline"} onClick={() => setForm({ ...form, replyMode: "ai" })}>
                    AI
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Max/Day</label>
                <Input type="number" min="1" max="100" className="mt-1" value={form.maxRepliesPerDay} onChange={(e) => setForm({ ...form, maxRepliesPerDay: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Min Delay (s)</label>
                <Input type="number" min="1" max="120" className="mt-1" value={form.minDelaySeconds} onChange={(e) => setForm({ ...form, minDelaySeconds: parseInt(e.target.value) || 1 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Max Delay (s)</label>
                <Input type="number" min="1" max="120" className="mt-1" value={form.maxDelaySeconds} onChange={(e) => setForm({ ...form, maxDelaySeconds: parseInt(e.target.value) || 1 })} />
              </div>
            </div>

            {form.replyMode === "template" ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Templates (one per line)</label>
                <textarea className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" rows={3} value={form.replyTemplates} onChange={(e) => setForm({ ...form, replyTemplates: e.target.value })} />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground">AI Prompt</label>
                <textarea className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" rows={3} value={form.aiPrompt} onChange={(e) => setForm({ ...form, aiPrompt: e.target.value })} />
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                <Save className="mr-1 h-3 w-3" />
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
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
          <Badge variant="outline" className="text-xs">{entry.source}</Badge>
          {entry.latencyMs != null && <span className="text-xs text-muted-foreground">{entry.latencyMs}ms</span>}
        </div>
        <p className="truncate text-sm text-muted-foreground">{entry.replyText}</p>
        {entry.error && <p className="text-xs text-red-400">{entry.error}</p>}
        <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
      </div>
    </div>
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
    setBreadcrumbs([{ label: "Auto-Reply" }]);
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

      {/* Settings */}
      <SettingsPanel />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
                {stats.budget.maxReplies - stats.budget.repliesSent}
              </div>
              <div className="text-xs text-muted-foreground">
                Replies Left ({stats.budget.repliesSent}/{stats.budget.maxReplies})
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold">{stats.budget.spentUsd.toFixed(2)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                of ${stats.budget.capUsd.toFixed(2)} cap
              </div>
              {/* Spend bar */}
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(100, (stats.budget.spentUsd / stats.budget.capUsd) * 100)}%` }}
                />
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
            <Button size="sm" variant="ghost" disabled={logPage <= 1} onClick={() => setLogPage((p) => p - 1)}>Prev</Button>
            <Button size="sm" variant="ghost" disabled={logEntries.length < 15} onClick={() => setLogPage((p) => p + 1)}>Next</Button>
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
