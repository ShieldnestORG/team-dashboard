import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Film,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import {
  videoEditApi,
  type VideoEditJob,
  type VideoEditOptionsInput,
} from "../api/videoEdit";

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    pending: "bg-zinc-500/10 text-zinc-400",
    running: "bg-yellow-500/10 text-yellow-500",
    ready: "bg-green-500/10 text-green-500",
    failed: "bg-red-500/10 text-red-500",
    canceled: "bg-zinc-500/10 text-zinc-500",
  };
  return <Badge className={colors[status] || colors.pending}>{status}</Badge>;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function VideoEdit() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Video Edit" }]);
  }, [setBreadcrumbs]);
  const qc = useQueryClient();
  const [inputDir, setInputDir] = useState("");
  const [editBrief, setEditBrief] = useState("");
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [burnCaptions, setBurnCaptions] = useState(true);

  const { data: config } = useQuery({
    queryKey: ["video-edit-config"],
    queryFn: videoEditApi.getConfig,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["video-edit-jobs"],
    queryFn: videoEditApi.getJobs,
    refetchInterval: (q) => {
      const jobs = (q.state.data as { jobs: VideoEditJob[] } | undefined)?.jobs || [];
      return jobs.some((j) => j.status === "running" || j.status === "pending")
        ? 5000
        : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const options: VideoEditOptionsInput = { aspect, burnCaptions };
      return videoEditApi.createJob({
        inputDir: inputDir.trim(),
        editBrief: editBrief.trim(),
        options,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["video-edit-jobs"] });
      setInputDir("");
      setEditBrief("");
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => videoEditApi.runJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-edit-jobs"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => videoEditApi.cancelJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-edit-jobs"] }),
  });

  const jobs = data?.jobs || [];
  const engineConfigured = config?.engineConfigured ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Film className="h-6 w-6 text-purple-500" />
        <h1 className="text-2xl font-semibold">Video Edit</h1>
        <span className="text-sm text-muted-foreground">
          Edit raw footage with browser-use/video-use
        </span>
      </div>

      {!engineConfigured && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-medium text-amber-500">Engine not configured</div>
              <div className="text-muted-foreground mt-1">
                Set <code className="px-1 py-0.5 rounded bg-zinc-800 text-xs">VIDEO_USE_BIN</code>{" "}
                to the path of your <code className="px-1 py-0.5 rounded bg-zinc-800 text-xs">video-use</code>{" "}
                entry script. Jobs can be queued, but won&apos;t run until the engine is configured.
                See <code className="px-1 py-0.5 rounded bg-zinc-800 text-xs">docs/products/video-edit.md</code>.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Edit Job</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Input directory (absolute path on server with raw .mp4 / .mov files)
            </label>
            <Input
              value={inputDir}
              onChange={(e) => setInputDir(e.target.value)}
              placeholder={`${config?.dataDir || "/paperclip/video-edit"}/raw/2026-05-21-walkthrough`}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Edit brief (natural language)
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              rows={4}
              value={editBrief}
              onChange={(e) => setEditBrief(e.target.value)}
              placeholder={
                'Edit into a 5-minute YouTube explainer.\n' +
                'Cinematic color grade. Burn 2-word captions.\n' +
                'Cut "umm"/"uh" and silences > 1s.'
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Aspect
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value as typeof aspect)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="16:9">16:9 (YouTube)</option>
                <option value="9:16">9:16 (Shorts / Reels)</option>
                <option value="1:1">1:1 (Square)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={burnCaptions}
                onChange={(e) => setBurnCaptions(e.target.checked)}
              />
              Burn captions
            </label>
            <div className="flex-1" />
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !inputDir.trim() || !editBrief.trim() || createMutation.isPending
              }
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" /> Queue Job
                </>
              )}
            </Button>
          </div>
          {createMutation.isError && (
            <div className="text-sm text-red-500">
              {(createMutation.error as Error)?.message || "Failed to create job"}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No jobs yet. Queue one above.
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-md border border-border p-3 space-y-2"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    {statusBadge(job.status)}
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(job.createdAt)}
                    </span>
                    {job.status === "running" && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500" />
                    )}
                    {job.status === "ready" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    )}
                    {job.status === "failed" && (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                    <div className="flex-1" />
                    {job.status === "pending" && engineConfigured && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runMutation.mutate(job.id)}
                        disabled={runMutation.isPending}
                      >
                        <Play className="h-3 w-3 mr-1" /> Run
                      </Button>
                    )}
                    {job.status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelMutation.mutate(job.id)}
                        disabled={cancelMutation.isPending}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  <div className="text-sm space-y-1">
                    <div>
                      <div className="text-muted-foreground text-xs">Input</div>
                      <code className="text-xs break-all">{job.inputDir}</code>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Brief</div>
                      <div className="text-xs whitespace-pre-wrap">{job.editBrief}</div>
                    </div>
                    {job.outputPath && (
                      <div>
                        <div className="text-muted-foreground text-xs">Output</div>
                        <code className="text-xs break-all">{job.outputPath}</code>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatBytes(job.fileSizeBytes)}
                          {job.durationSec != null && ` · ${job.durationSec.toFixed(1)}s`}
                        </span>
                      </div>
                    )}
                    {job.error && (
                      <div>
                        <div className="text-red-500 text-xs">Error</div>
                        <code className="text-xs break-all text-red-400">{job.error}</code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
