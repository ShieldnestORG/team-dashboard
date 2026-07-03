import { api } from "./client";

// CONTRACT-3 — voice-snippet factory (server/src/routes/voice-snippets.ts).
// Generation is click-triggered ONLY: the UI calls generate() from a button
// handler, never on page load/mount (shared ElevenLabs key = real money).

export interface VoiceSnippetResult {
  assetId: string;
  /** Relative playback/download URL (GET /api/assets/:id/content). */
  contentPath: string;
  /** Persona display name (e.g. "Mark") — never a raw ElevenLabs voice name. */
  voiceName: string;
  durationSec: number | null;
  byteSize: number;
  /** true = this exact line was generated before; the saved audio is reused. */
  cached: boolean;
}

export interface VoiceSnippetHealth {
  ok: boolean;
  missingVoices: string[];
  error?: string;
}

export const voiceSnippetsApi = {
  generate: (input: { voiceKey: string; text: string; kitId?: number; field?: string }) =>
    api.post<VoiceSnippetResult>("/voice-snippets", input),
  health: () => api.get<VoiceSnippetHealth>("/voice-snippets/health"),
};
