import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialsApi, type SocialAccount, type SocialAutomation } from "../../api/socials";
import { systemCronsApi, type SystemCronJob } from "../../api/system-crons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, Check, X, Pencil, RefreshCw, Loader2, Play } from "lucide-react";

const POLL_COUNTERS_MS = 5_000;
const POLL_OTHER_MS = 30_000;

function counterTone(used: number, cap: number): "ok" | "warn" | "danger" {
  if (used >= cap) return "danger";
  if (used >= cap - 1) return "warn";
  return "ok";
}

function toneClass(tone: "ok" | "warn" | "danger"): string {
  if (tone === "danger") return "text-red-400";
  if (tone === "warn") return "text-yellow-400";
  return "text-emerald-400";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

// ── Cap inline editor ──────────────────────────────────────────────────────

function CapEditor({
  value,
  onSave,
  label,
}: {
  value: number;
  onSave: (n: number) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        title={`Edit ${label}`}
      >
        <span>{label}: </span>
        <span className="font-mono text-foreground">{value}</span>
        <Pencil className="h-2.5 w-2.5 opacity-50" />
      </button>
    );
  }

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(Math.floor(n));
    setEditing(false);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-6 w-14 px-1 font-mono text-xs"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={commit}
      />
      <button onClick={commit} className="text-emerald-400 hover:text-emerald-300">
        <Check className="h-3 w-3" />
      </button>
      <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ── Cron expression inline editor ──────────────────────────────────────────

function CronEditor({
  job,
  onSave,
}: {
  job: SystemCronJob;
  onSave: (scheduleOverride: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const current = job.scheduleOverride || job.schedule;
  const [draft, setDraft] = useState(current);

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(current); setEditing(true); }}
        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        title="Click to edit cron expression"
      >
        <Clock className="h-3 w-3" />
        {current}
        {job.scheduleOverride && (
          <span className="text-yellow-400 text-[10px]">(custom)</span>
        )}
        <Pencil className="h-2.5 w-2.5 opacity-50" />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-6 w-32 px-1 font-mono text-xs"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onSave(draft === job.schedule ? null : draft);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button
        onClick={() => { onSave(draft === job.schedule ? null : draft); setEditing(false); }}
        className="text-emerald-400 hover:text-emerald-300"
      >
        <Check className="h-3 w-3" />
      </button>
      <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
      {job.scheduleOverride && (
        <button
          onClick={() => { onSave(null); setEditing(false); }}
          className="text-yellow-400 hover:text-yellow-300"
          title="Reset to default"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// ── Automation row ─────────────────────────────────────────────────────────

function AutomationRow({
  automation,
  cron,
}: {
  automation: SocialAutomation;
  cron: SystemCronJob | undefined;
}) {
  const qc = useQueryClient();
  const enabled = cron?.enabled ?? automation.enabled;

  const toggleMut = useMutation({
    mutationFn: (next: boolean) => systemCronsApi.update(automation.sourceRef, { enabled: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-crons"] });
      qc.invalidateQueries({ queryKey: ["socials", "automations"] });
    },
  });

  const scheduleMut = useMutation({
    mutationFn: (override: string | null) =>
      systemCronsApi.update(automation.sourceRef, { scheduleOverride: override }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["system-crons"] });
      qc.invalidateQueries({ queryKey: ["socials", "automations"] });
    },
  });

  const triggerMut = useMutation({
    mutationFn: () => systemCronsApi.trigger(automation.sourceRef),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ["system-crons"] }), 1500);
    },
  });

  return (
    <div
      className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
        enabled ? "bg-card" : "opacity-50 bg-muted/20"
      }`}
    >
      <button
        onClick={() => toggleMut.mutate(!enabled)}
        disabled={toggleMut.isPending}
        className={`shrink-0 relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
        } ${toggleMut.isPending ? "opacity-50" : ""}`}
        title={enabled ? "Pause" : "Resume"}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
            enabled ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono truncate" title={automation.sourceRef}>
            {automation.sourceRef}
          </span>
          {automation.personalityId && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {automation.personalityId}
            </Badge>
          )}
          {automation.contentType && (
            <span className="text-[10px] text-muted-foreground">{automation.contentType}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {cron ? (
            <CronEditor job={cron} onSave={(s) => scheduleMut.mutate(s)} />
          ) : (
            <span className="font-mono text-[10px] text-muted-foreground">{automation.cronExpr}</span>
          )}
          <span className="text-[10px] text-muted-foreground">
            Last: {timeAgo(automation.lastRunAt)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Next: {timeUntil(automation.nextRunAt)}
          </span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={() => triggerMut.mutate()}
        disabled={triggerMut.isPending || !enabled}
        title="Run now"
      >
        {triggerMut.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}

// ── Account row ────────────────────────────────────────────────────────────

const AUTOMATION_MODES: SocialAccount["automationMode"][] = [
  "manual",
  "assisted",
  "full_auto",
  "none",
];

function AccountRow({ account }: { account: SocialAccount }) {
  const qc = useQueryClient();
  const updateMut = useMutation({
    mutationFn: (mode: SocialAccount["automationMode"]) =>
      socialsApi.updateAccount(account.id, { automationMode: mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socials", "accounts"] }),
  });

  return (
    <div className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {account.brand} · {account.handle}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {account.connectionType} · {account.status}
        </div>
      </div>
      <select
        className="rounded border bg-background px-1.5 py-0.5 text-xs"
        value={account.automationMode}
        onChange={(e) => updateMut.mutate(e.target.value as SocialAccount["automationMode"])}
        disabled={updateMut.isPending}
      >
        {AUTOMATION_MODES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function SocialsSchedule() {
  const qc = useQueryClient();

  const capsQuery = useQuery({
    queryKey: ["socials", "platform-caps"],
    queryFn: () => socialsApi.listPlatformCaps(),
    refetchInterval: POLL_OTHER_MS,
  });
  const countersQuery = useQuery({
    queryKey: ["socials", "platform-counters"],
    queryFn: () => socialsApi.listPlatformCounters(),
    refetchInterval: POLL_COUNTERS_MS,
  });
  const accountsQuery = useQuery({
    queryKey: ["socials", "accounts"],
    queryFn: () => socialsApi.listAccounts(),
    refetchInterval: POLL_OTHER_MS,
  });
  const automationsQuery = useQuery({
    queryKey: ["socials", "automations"],
    queryFn: () => socialsApi.listAutomations(),
    refetchInterval: POLL_OTHER_MS,
  });
  const cronsQuery = useQuery({
    queryKey: ["system-crons"],
    queryFn: () => systemCronsApi.list(),
    refetchInterval: POLL_OTHER_MS,
  });

  const updateCapMut = useMutation({
    mutationFn: ({ platform, body }: { platform: string; body: Parameters<typeof socialsApi.updatePlatformCap>[1] }) =>
      socialsApi.updatePlatformCap(platform, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["socials", "platform-caps"] });
      qc.invalidateQueries({ queryKey: ["socials", "platform-counters"] });
    },
  });

  if (capsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading platforms…</div>;
  }

  const caps = capsQuery.data?.caps ?? [];
  const counters = countersQuery.data?.counters ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];
  const automations = automationsQuery.data?.automations ?? [];
  const crons = cronsQuery.data?.crons ?? [];

  const counterByPlatform = new Map(counters.map((c) => [c.platform, c]));
  const cronByJobName = new Map(crons.map((j) => [j.jobName, j]));

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Per-platform daily caps, automations, and account modes. Counters refresh every 5s.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {caps.map((cap) => {
          const counter = counterByPlatform.get(cap.platform);
          const platformAccounts = accounts.filter((a) => a.platform === cap.platform);
          const accountIds = new Set(platformAccounts.map((a) => a.id));
          const platformAutomations = automations.filter(
            (a) => a.socialAccountId && accountIds.has(a.socialAccountId),
          );

          const genTone = counter ? counterTone(counter.generatedToday, counter.generatedCap) : "ok";
          const pubTone = counter ? counterTone(counter.publishedToday, counter.publishedCap) : "ok";

          return (
            <Card key={cap.platform} className={cap.enabled ? "" : "opacity-60"}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs uppercase">{cap.platform}</Badge>
                    {!cap.enabled && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        caps disabled
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={() => updateCapMut.mutate({ platform: cap.platform, body: { enabled: !cap.enabled } })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      cap.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                    }`}
                    title={cap.enabled ? "Disable cap enforcement" : "Enable cap enforcement"}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        cap.enabled ? "translate-x-4.5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Counters */}
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Generated</div>
                    <div className={`font-mono ${toneClass(genTone)}`}>
                      {counter?.generatedToday ?? 0}/{cap.maxGeneratedPerDay}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Published</div>
                    <div className={`font-mono ${toneClass(pubTone)}`}>
                      {counter?.publishedToday ?? 0}/{cap.maxPublishedPerDay}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Queued</div>
                    <div className="font-mono">{counter?.queued ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase">Failed 24h</div>
                    <div className={`font-mono ${(counter?.failed24h ?? 0) > 0 ? "text-red-400" : ""}`}>
                      {counter?.failed24h ?? 0}
                    </div>
                  </div>
                </div>

                {/* Caps editor */}
                <div className="flex items-center gap-4 border-t pt-2">
                  <CapEditor
                    label="gen/day"
                    value={cap.maxGeneratedPerDay}
                    onSave={(n) => updateCapMut.mutate({ platform: cap.platform, body: { maxGeneratedPerDay: n } })}
                  />
                  <CapEditor
                    label="pub/day"
                    value={cap.maxPublishedPerDay}
                    onSave={(n) => updateCapMut.mutate({ platform: cap.platform, body: { maxPublishedPerDay: n } })}
                  />
                </div>

                {/* Automations */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    Automations ({platformAutomations.length})
                  </div>
                  {platformAutomations.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground italic">No automations.</div>
                  ) : (
                    platformAutomations.map((a) => (
                      <AutomationRow
                        key={a.id}
                        automation={a}
                        cron={cronByJobName.get(a.sourceRef)}
                      />
                    ))
                  )}
                </div>

                {/* Accounts */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    Accounts ({platformAccounts.length})
                  </div>
                  {platformAccounts.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground italic">No accounts on this platform.</div>
                  ) : (
                    platformAccounts.map((a) => <AccountRow key={a.id} account={a} />)
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
