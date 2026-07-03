import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

const LLM_PROVIDER_OPTIONS = [
  { value: "ollama", label: "Local Ollama" },
  { value: "claude", label: "Claude API" },
] as const;

type LlmProvider = (typeof LLM_PROVIDER_OPTIONS)[number]["value"];

export function InstanceGeneralSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "General" },
    ]);
  }, [setBreadcrumbs]);

  const generalQuery = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      instanceSettingsApi.updateGeneral({ censorUsernameInLogs: enabled }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update general settings.");
    },
  });

  const providerMutation = useMutation({
    mutationFn: async (provider: LlmProvider) =>
      instanceSettingsApi.updateGeneral({ contentLlmProvider: provider }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update general settings.");
    },
  });

  const modelMutation = useMutation({
    mutationFn: async (model: string) =>
      instanceSettingsApi.updateGeneral({ contentLlmModel: model }),
    onSuccess: async () => {
      setActionError(null);
      setModelDraft(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update general settings.");
    },
  });

  if (generalQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading general settings...</div>;
  }

  if (generalQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {generalQuery.error instanceof Error
          ? generalQuery.error.message
          : "Failed to load general settings."}
      </div>
    );
  }

  const censorUsernameInLogs = generalQuery.data?.censorUsernameInLogs === true;
  const contentLlmProvider: LlmProvider =
    generalQuery.data?.contentLlmProvider === "claude" ? "claude" : "ollama";
  const savedModel = generalQuery.data?.contentLlmModel ?? "";
  const modelValue = modelDraft ?? savedModel;
  const modelDirty = modelDraft !== null && modelDraft.trim() !== savedModel;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">General</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure instance-wide defaults: how operator-visible logs are displayed, and which
          provider (Ollama or Claude) powers content generation.
        </p>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">Censor username in logs</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Hide the username segment in home-directory paths and similar operator-visible log output. Standalone
              username mentions outside of paths are not yet masked in the live transcript view. This is off by
              default.
            </p>
          </div>
          <button
            type="button"
            data-slot="toggle"
            aria-label="Toggle username log censoring"
            disabled={toggleMutation.isPending}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              censorUsernameInLogs ? "bg-green-600" : "bg-muted",
            )}
            onClick={() => toggleMutation.mutate(!censorUsernameInLogs)}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                censorUsernameInLogs ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">Content generation LLM</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Which provider generates marketing content (posts, blog slideshows, video angles). If the selected
              provider fails and the other one is configured, calls automatically fall back to it. Utility
              classifiers elsewhere are unaffected.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="content-llm-provider">
                Provider
              </label>
              <select
                id="content-llm-provider"
                value={contentLlmProvider}
                disabled={providerMutation.isPending}
                onChange={(e) => providerMutation.mutate(e.target.value as LlmProvider)}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-ring focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {LLM_PROVIDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor="content-llm-model">
                Model override (optional)
              </label>
              <div className="flex gap-2">
                <input
                  id="content-llm-model"
                  type="text"
                  value={modelValue}
                  placeholder="Provider default"
                  disabled={modelMutation.isPending}
                  onChange={(e) => setModelDraft(e.target.value)}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-ring focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={!modelDirty || modelMutation.isPending}
                  onClick={() => modelMutation.mutate(modelValue.trim())}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Leave blank to use the selected provider's default model. Applies to the selected provider only.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
