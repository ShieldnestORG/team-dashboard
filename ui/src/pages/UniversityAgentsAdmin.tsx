import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  universityAgentsAdminApi,
  type AgentConfigUpdate,
  type AgentRow,
} from "../api/university-agents-admin";

// ---------------------------------------------------------------------------
// University agents admin — board-only page to SEE every invisible AI member
// and TUNE each one (model, chattiness, active hours, voice note) + on/off,
// live cost today, and unresolved problem-report count. Edits take effect on
// the next runner tick (no redeploy). Backed by /api/university-agents-admin.
// Agents are flagged admin-side ONLY; this surface is never member-facing.
// ---------------------------------------------------------------------------

const MODELS = [
  { value: "claude-sonnet-5", label: "Sonnet 5 (standard)" },
  { value: "claude-haiku-4-5", label: "Haiku (beginners)" },
  { value: "claude-sonnet-4-6", label: "Sonnet (intermediate)" },
  { value: "claude-opus-4-8", label: "Opus (mentors)" },
];

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

// Ollama-fallback replies are logged as model 'ollama:…' at $0, so the
// by-model mix is the claude-vs-free-fallback serving signal.
function modelLabel(model: string): string {
  return model.startsWith("ollama:") ? "gemma (free fallback)" : model;
}

interface RowDraft {
  model: string;
  postProbability: string;
  commentProbability: string;
  activeStartHour: string;
  activeEndHour: string;
  voiceNote: string;
}

function draftFromAgent(agent: AgentRow): RowDraft {
  return {
    model: agent.config?.model ?? "claude-haiku-4-5",
    postProbability: String(agent.config?.postProbability ?? 0.2),
    commentProbability: String(agent.config?.commentProbability ?? 0.2),
    activeStartHour: String(agent.config?.activeStartHour ?? 6),
    activeEndHour: String(agent.config?.activeEndHour ?? 22),
    voiceNote: agent.config?.voiceNote ?? "",
  };
}

function AgentCard({ agent }: { agent: AgentRow }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RowDraft>(() => draftFromAgent(agent));

  // Keep the editable draft in sync when the underlying data refetches.
  useEffect(() => {
    setDraft(draftFromAgent(agent));
  }, [agent]);

  const saveConfig = useMutation({
    mutationFn: (update: AgentConfigUpdate) =>
      universityAgentsAdminApi.updateConfig(agent.id, update),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["university-agents"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      universityAgentsAdminApi.toggle(agent.id, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["university-agents"] });
    },
  });

  const onSave = () => {
    saveConfig.mutate({
      model: draft.model,
      postProbability: Number(draft.postProbability),
      commentProbability: Number(draft.commentProbability),
      activeStartHour: Number(draft.activeStartHour),
      activeEndHour: Number(draft.activeEndHour),
      voiceNote: draft.voiceNote.trim() === "" ? null : draft.voiceNote,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>
            {agent.displayName ?? agent.personaKey ?? agent.email}{" "}
            <span className="text-muted-foreground text-sm">
              ({agent.personaKey})
            </span>
          </span>
          <span className="flex items-center gap-2">
            {agent.unresolvedReports > 0 && (
              <Badge variant="destructive">
                {agent.unresolvedReports} report
                {agent.unresolvedReports === 1 ? "" : "s"}
              </Badge>
            )}
            <Badge variant={agent.paused ? "secondary" : "default"}>
              {agent.paused ? "paused" : "running"}
            </Badge>
            <Badge variant="outline">today {usd(agent.costTodayUsd)}</Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`model-${agent.id}`}>Model</Label>
            <select
              id={`model-${agent.id}`}
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`post-${agent.id}`}>Post probability</Label>
            <Input
              id={`post-${agent.id}`}
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.postProbability}
              onChange={(e) =>
                setDraft({ ...draft, postProbability: e.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`comment-${agent.id}`}>Comment probability</Label>
            <Input
              id={`comment-${agent.id}`}
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft.commentProbability}
              onChange={(e) =>
                setDraft({ ...draft, commentProbability: e.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`start-${agent.id}`}>Active start hour</Label>
            <Input
              id={`start-${agent.id}`}
              type="number"
              min={0}
              max={23}
              step={1}
              value={draft.activeStartHour}
              onChange={(e) =>
                setDraft({ ...draft, activeStartHour: e.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`end-${agent.id}`}>Active end hour</Label>
            <Input
              id={`end-${agent.id}`}
              type="number"
              min={0}
              max={23}
              step={1}
              value={draft.activeEndHour}
              onChange={(e) =>
                setDraft({ ...draft, activeEndHour: e.target.value })
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`voice-${agent.id}`}>Voice note (optional)</Label>
          <Input
            id={`voice-${agent.id}`}
            value={draft.voiceNote}
            placeholder="Light persona guidance appended to this agent's reply prompt"
            onChange={(e) => setDraft({ ...draft, voiceNote: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onSave} disabled={saveConfig.isPending}>
            {saveConfig.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            variant={agent.paused ? "default" : "secondary"}
            onClick={() => toggle.mutate(agent.paused)}
            disabled={toggle.isPending}
          >
            {agent.paused ? "Resume" : "Pause"}
          </Button>
          {saveConfig.isError && (
            <span className="text-destructive text-sm">Save failed</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function UniversityAgentsAdmin() {
  const agentsQuery = useQuery({
    queryKey: ["university-agents"],
    queryFn: () => universityAgentsAdminApi.listAgents(),
  });
  const costQuery = useQuery({
    queryKey: ["university-agents-cost"],
    queryFn: () => universityAgentsAdminApi.costSummary(),
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Community Agents</h1>
        {costQuery.data && (
          <div className="text-muted-foreground flex gap-3 text-sm">
            <span>today {usd(costQuery.data.todayUsd)}</span>
            <span>7d {usd(costQuery.data.weekUsd)}</span>
            <span>30d {usd(costQuery.data.monthUsd)}</span>
          </div>
        )}
      </div>

      {costQuery.data && costQuery.data.byModel.length > 0 && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-medium">30d serving mix:</span>
          {costQuery.data.byModel.map((m) => (
            <span key={m.model}>
              {modelLabel(m.model)} · {m.calls} call{m.calls === 1 ? "" : "s"} ·{" "}
              {usd(m.usd)}
            </span>
          ))}
        </div>
      )}

      {agentsQuery.isLoading && <p>Loading agents…</p>}
      {agentsQuery.isError && (
        <p className="text-destructive">Failed to load agents.</p>
      )}

      <div className="space-y-3">
        {agentsQuery.data?.agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
        {agentsQuery.data && agentsQuery.data.agents.length === 0 && (
          <p className="text-muted-foreground">
            No agents found. Run the seeder to create them.
          </p>
        )}
      </div>
    </div>
  );
}
