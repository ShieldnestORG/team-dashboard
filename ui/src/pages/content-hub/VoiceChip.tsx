import { useState } from "react";
import { AudioLines, Download, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/client";
import { voiceSnippetsApi, type VoiceSnippetResult } from "@/api/voice-snippets";
import type { KitSpokenLine } from "@/content/marketing-kits";
import { personaName, snippetFileName } from "./kit-status";

type ChipState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; result: VoiceSnippetResult }
  | { phase: "error"; message: string };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // The server's errors are already plain English ("Voice generation isn't
    // set up yet — tell Mark."); show them as-is.
    const body = err.body as { error?: unknown } | null;
    if (body && typeof body.error === "string") return body.error;
    if (err.status === 503) return "Voice generation isn't set up yet — tell Mark.";
  }
  return "Couldn't make the audio. Try again in a minute.";
}

/**
 * One spoken line → one audio chip. Idle until clicked — generation is
 * NEVER triggered on mount (shared voice key = real cost per generation).
 * Once generated: play, download, or drag the file straight into Finder or
 * a video editor (DataTransfer DownloadURL — Chromium-only; the download
 * button is the works-everywhere fallback).
 */
export function VoiceChip({ line, kitId }: { line: KitSpokenLine; kitId: number }) {
  const [state, setState] = useState<ChipState>({ phase: "idle" });
  const voice = personaName(line.voiceKey);

  async function generate() {
    setState({ phase: "loading" });
    try {
      const result = await voiceSnippetsApi.generate({
        voiceKey: line.voiceKey,
        text: line.text,
        kitId,
        field: line.label,
      });
      setState({ phase: "ready", result });
    } catch (err) {
      setState({ phase: "error", message: errorMessage(err) });
    }
  }

  if (state.phase === "idle") {
    return (
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={generate}>
          <AudioLines className="h-4 w-4 text-[#FF6B4A]" />
          Generate audio
        </Button>
        <span className="text-sm text-muted-foreground">{voice}'s voice</span>
      </div>
    );
  }

  if (state.phase === "loading") {
    return (
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled>
          <AudioLines className="h-4 w-4 animate-pulse text-[#FF6B4A]" />
          Making the audio…
        </Button>
        <span className="text-sm text-muted-foreground">{voice}'s voice</span>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-destructive">{state.message}</span>
        <Button type="button" variant="outline" size="sm" onClick={generate}>
          Try again
        </Button>
      </div>
    );
  }

  const { result } = state;
  const fileName = snippetFileName(line.voiceKey, line.label);
  const absoluteUrl =
    typeof window !== "undefined"
      ? new URL(result.contentPath, window.location.origin).toString()
      : result.contentPath;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <audio controls preload="none" src={result.contentPath} className="h-9 max-w-full" />
      {result.durationSec !== null && (
        <span className="text-xs text-muted-foreground">~{Math.round(result.durationSec)}s</span>
      )}
      <span className="text-xs text-muted-foreground">
        {voice}'s voice · {result.cached ? "made earlier — same audio" : "freshly made"}
      </span>
      <Button asChild variant="outline" size="sm">
        <a href={result.contentPath} download={fileName}>
          <Download className="h-4 w-4" />
          Download
        </a>
      </Button>
      <span
        draggable
        title="Drag this into Finder or your video editor (works in Chrome). Elsewhere, use Download."
        onDragStart={(event) => {
          // Chromium-only drag-out; the Download button is the universal fallback.
          event.dataTransfer.setData("DownloadURL", `audio/mpeg:${fileName}:${absoluteUrl}`);
          event.dataTransfer.setData("text/uri-list", absoluteUrl);
        }}
        className="inline-flex cursor-grab items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
        Drag out
      </span>
    </div>
  );
}
