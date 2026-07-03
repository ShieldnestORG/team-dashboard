import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { voiceSnippets, type VoiceSnippet } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { assetService } from "./assets.js";

// ---------------------------------------------------------------------------
// Content Hub voice-snippet factory: text → ElevenLabs TTS → mp3 bytes in the
// StorageService/assets pipeline, metadata cached in voice_snippets (0147).
//
// KEY DECISION (verified live 2026-07-02): the key in ELEVENLABS_API_KEY
// belongs to a DIFFERENT ElevenLabs account (video-edit Scribe) with NONE of
// the 5 voices below. This service reads ELEVENLABS_VOICE_KEY with NO
// fallback — when unset, callers get VoiceNotConfiguredError (route → 503
// with a plain-English message). Never repoint or reuse the Scribe key.
//
// Voice ids and settings are pinned SERVER-SIDE. Never accept a voice_id from
// the client: the key is shared and the endpoint is board-reachable — a
// client-supplied id would be arbitrary billing on Mark's account.
//
// Settings follow Ig_Auditor's tts.py v5 (source of truth). Note there is
// deliberately NO use_speaker_boost anywhere: eleven_v3 rejects it
// (build_vo_ts.py sends it and is wrong). The ffmpeg mastering chain from
// build_brand_vo.py is NOT replicated for MVP — raw v3 output ships; the
// sound delta is flagged in the Wave 4 report.
//
// Never log the key or full ElevenLabs response bodies (log-redaction
// conventions): errors carry status codes and short labels only.
// ---------------------------------------------------------------------------

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";
export const VOICE_MODEL_ID = "eleven_v3";
export const VOICE_OUTPUT_FORMAT = "mp3_44100_128";
// mp3_44100_128 is CBR 128 kbit/s = 16000 bytes/s — good enough for a chip label.
const MP3_BYTES_PER_SECOND = 16000;
// Kit snippets run 150-400 chars. Hard-cap well below eleven_v3's ~3000 limit:
// this endpoint is a kit-line factory, not a general TTS service.
export const MAX_SNIPPET_TEXT_CHARS = 1500;

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
}

export interface RegistryVoice {
  voiceId: string;
  /** Persona label shown to marketing users — NEVER the raw ElevenLabs voice name. */
  displayName: string;
  settings: VoiceSettings;
}

// Persona voices share one settings block; Mark's clone uses the v5 brand block.
const PERSONA_SETTINGS: VoiceSettings = { stability: 0.45, similarity_boost: 0.85, style: 0.45 };

export const VOICE_REGISTRY: Record<string, RegistryVoice> = {
  mark: {
    voiceId: "n45mfBjBoGc0McY8O2Aw", // Mark_new_2026 (clone)
    displayName: "Mark",
    settings: { stability: 0.0, similarity_boost: 0.9, style: 0.0 },
  },
  brianna: { voiceId: "BeKZH03brdNaVyYtd97H", displayName: "Brianna", settings: PERSONA_SETTINGS },
  // Spanish text is fine — eleven_v3 is multilingual.
  mami: { voiceId: "cw0sQ4mVjT9BbISUtO51", displayName: "Mami", settings: PERSONA_SETTINGS },
  remy: { voiceId: "zmcVlqmyk3Jpn5AVYcAL", displayName: "Remy", settings: PERSONA_SETTINGS },
  solene: { voiceId: "CKfuQaJKfvUG2Wtrda3Y", displayName: "Solène", settings: PERSONA_SETTINGS },
};

export const VOICE_KEYS = Object.keys(VOICE_REGISTRY);

/** ELEVENLABS_VOICE_KEY is unset — voice generation is not configured. */
export class VoiceNotConfiguredError extends Error {
  constructor() {
    super("voice generation not configured (ELEVENLABS_VOICE_KEY is unset)");
  }
}

// Cost-abuse guard: every cache MISS is a paid ElevenLabs call on Mark's
// voice-owning account, and distinct text always misses — so a scripted
// loop of unique texts is unbounded spend. Cap paid generations per user
// per UTC day (cache hits are free and never counted). In-memory on purpose:
// single-process server, and a restart resetting the counter is fine for an
// abuse guard. Override via VOICE_SNIPPETS_DAILY_LIMIT (tests use this).
export const DEFAULT_DAILY_GENERATION_LIMIT = 200;

export function dailyGenerationLimit(): number {
  const raw = process.env.VOICE_SNIPPETS_DAILY_LIMIT;
  const parsed = raw === undefined || raw === "" ? NaN : Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return DEFAULT_DAILY_GENERATION_LIMIT;
}

/** The per-user daily paid-generation cap was hit (route → 429). */
export class VoiceQuotaExceededError extends Error {
  limit: number;
  constructor(limit: number) {
    super(`daily voice-generation limit reached (${limit} new snippets per day)`);
    this.limit = limit;
  }
}

/** ElevenLabs answered with a non-2xx status. Carries no response body. */
export class ElevenLabsError extends Error {
  status: number;
  constructor(status: number, label: string) {
    super(`ElevenLabs ${label} failed with status ${status}`);
    this.status = status;
  }
}

function requireVoiceKey(): string {
  // Read at call time so a key added to the env is picked up on restart
  // without module-load ordering issues. NO fallback to ELEVENLABS_API_KEY —
  // that is a different account (video-edit Scribe) with none of these voices.
  const key = process.env.ELEVENLABS_VOICE_KEY;
  if (!key) throw new VoiceNotConfiguredError();
  return key;
}

/** JSON.stringify with recursively sorted object keys — canonical cache identity. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeSnippetText(text: string): string {
  return text.normalize("NFC").trim();
}

export function buildCacheKey(voice: RegistryVoice, normalizedText: string): string {
  const canonical = stableStringify({
    modelId: VOICE_MODEL_ID,
    outputFormat: VOICE_OUTPUT_FORMAT,
    settings: voice.settings,
    text: normalizedText,
    voiceId: voice.voiceId,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface GenerateSnippetInput {
  voiceKey: string;
  text: string;
  companyId: string;
  createdByUserId: string | null;
}

export interface GenerateSnippetResult {
  snippet: VoiceSnippet;
  voiceName: string;
  /** false = freshly generated this call (or won by a concurrent twin). */
  cached: boolean;
}

export function voiceSnippetService(
  db: Db,
  storage: StorageService,
  fetchImpl: typeof fetch = fetch,
) {
  const assetSvc = assetService(db);
  // Concurrent double-click dedupe: one in-process generation per cache key.
  // The DB unique index + ON CONFLICT DO NOTHING covers the multi-process race.
  const inflight = new Map<string, Promise<VoiceSnippet>>();
  // Paid generations per user per UTC day (see VoiceQuotaExceededError above).
  const generationsToday = new Map<string, { day: string; count: number }>();

  /** Count a paid generation against the user's daily cap; throw at the cap. */
  function consumeDailyQuota(createdByUserId: string | null): void {
    // The local_trusted implicit dev principal has no user row — keyed
    // under one shared bucket so even dev/agent traffic stays bounded.
    const key = createdByUserId ?? "(no-user)";
    const day = new Date().toISOString().slice(0, 10);
    const limit = dailyGenerationLimit();
    const entry = generationsToday.get(key);
    const count = entry && entry.day === day ? entry.count : 0;
    if (count >= limit) throw new VoiceQuotaExceededError(limit);
    generationsToday.set(key, { day, count: count + 1 });
  }

  async function findByCacheKey(cacheKey: string): Promise<VoiceSnippet | null> {
    const rows = await db
      .select()
      .from(voiceSnippets)
      .where(eq(voiceSnippets.cacheKey, cacheKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async function callElevenLabsTts(voice: RegistryVoice, text: string): Promise<Buffer> {
    const apiKey = requireVoiceKey();
    const url =
      `${ELEVENLABS_API_BASE}/v1/text-to-speech/${voice.voiceId}` +
      `?output_format=${VOICE_OUTPUT_FORMAT}`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: VOICE_MODEL_ID,
        voice_settings: voice.settings,
      }),
    });
    if (!res.ok) {
      // Deliberately drop the response body: it can echo request details and
      // we never log full ElevenLabs responses.
      throw new ElevenLabsError(res.status, "text-to-speech");
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async function generateAndPersist(
    voiceKey: string,
    voice: RegistryVoice,
    normalizedText: string,
    cacheKey: string,
    companyId: string,
    createdByUserId: string | null,
  ): Promise<VoiceSnippet> {
    const audio = await callElevenLabsTts(voice, normalizedText);
    const stored = await storage.putFile({
      companyId,
      namespace: "assets/voice-snippets",
      originalFilename: `${voiceKey}-${cacheKey.slice(0, 8)}.mp3`,
      contentType: "audio/mpeg",
      body: audio,
    });
    const asset = await assetSvc.create(companyId, {
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: null,
      createdByUserId,
    });
    const durationSec = Math.round((stored.byteSize / MP3_BYTES_PER_SECOND) * 100) / 100;
    // DB-level race safety: a concurrent process may have inserted the same
    // cache key first — DO NOTHING, then re-select whichever row won.
    await db
      .insert(voiceSnippets)
      .values({
        companyId,
        cacheKey,
        voiceKey,
        voiceId: voice.voiceId,
        modelId: VOICE_MODEL_ID,
        settings: voice.settings as unknown as Record<string, number>,
        text: normalizedText,
        assetId: asset.id,
        durationSec: String(durationSec),
        byteSize: stored.byteSize,
        createdByUserId,
      })
      .onConflictDoNothing({ target: voiceSnippets.cacheKey });
    const row = await findByCacheKey(cacheKey);
    if (!row) {
      throw new Error("voice snippet row missing after insert");
    }
    return row;
  }

  return {
    /**
     * Cache-first generate. Cache hits never touch ElevenLabs (they even work
     * with the key unset); misses require ELEVENLABS_VOICE_KEY and are deduped
     * in-process per cache key. Click-triggered only by design — this is the
     * POST handler's body, never called on page load.
     */
    async generate(input: GenerateSnippetInput): Promise<GenerateSnippetResult> {
      const voice = VOICE_REGISTRY[input.voiceKey];
      if (!voice) {
        throw new Error(`unknown voice key: ${input.voiceKey}`);
      }
      const normalizedText = normalizeSnippetText(input.text);
      const cacheKey = buildCacheKey(voice, normalizedText);

      const existing = await findByCacheKey(cacheKey);
      if (existing) {
        return { snippet: existing, voiceName: voice.displayName, cached: true };
      }

      let promise = inflight.get(cacheKey);
      if (!promise) {
        // Only a NEW paid generation consumes quota — cache hits (above) and
        // piggy-backing on an in-flight twin never do.
        consumeDailyQuota(input.createdByUserId);
        promise = generateAndPersist(
          input.voiceKey,
          voice,
          normalizedText,
          cacheKey,
          input.companyId,
          input.createdByUserId,
        ).finally(() => inflight.delete(cacheKey));
        inflight.set(cacheKey, promise);
      }
      const snippet = await promise;
      return { snippet, voiceName: voice.displayName, cached: false };
    },

    /**
     * Health: does the configured key's account expose every registry voice?
     * This is the exact check that caught the wrong-account Scribe key.
     * Click-triggered / curl only — never auto-polled.
     */
    async health(): Promise<{ ok: boolean; missingVoices: string[] }> {
      const apiKey = requireVoiceKey();
      const res = await fetchImpl(`${ELEVENLABS_API_BASE}/v2/voices?page_size=100`, {
        method: "GET",
        headers: { "xi-api-key": apiKey },
      });
      if (!res.ok) {
        throw new ElevenLabsError(res.status, "voices list");
      }
      const body = (await res.json()) as { voices?: Array<{ voice_id?: string }> };
      const available = new Set(
        (body.voices ?? []).map((v) => v.voice_id).filter((id): id is string => Boolean(id)),
      );
      const missingVoices = Object.entries(VOICE_REGISTRY)
        .filter(([, voice]) => !available.has(voice.voiceId))
        .map(([key]) => key);
      return { ok: missingVoices.length === 0, missingVoices };
    },
  };
}
