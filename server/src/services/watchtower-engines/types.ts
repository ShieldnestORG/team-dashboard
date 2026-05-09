// ---------------------------------------------------------------------------
// Watchtower engine adapter contract — every adapter returns this shape.
//
// `text` is the raw model response (what gets persisted to
// watchtower_results.raw_response). The watchtower-monitor service does
// detection and sentiment classification on top — adapters are pure
// transport.
// ---------------------------------------------------------------------------

export type EngineId = "chatgpt" | "claude" | "perplexity" | "gemini";

export interface EngineQuery {
  prompt: string;
}

export interface EngineResponse {
  /** Raw response text from the model. Empty string if the call failed in
   *  a way the adapter wants to surface as a non-fatal "no result". */
  text: string;
  /** Wall-clock latency of the model call in milliseconds. */
  latencyMs: number;
  /** True iff the underlying API call succeeded and returned text. */
  ok: boolean;
  /** Optional human-readable error string when ok=false. Logged but not
   *  persisted to a separate column in v1. */
  error?: string;
}

export interface EngineAdapter {
  id: EngineId;
  /** Returns true iff the adapter is configured (env vars present). The
   *  watchtower-monitor will skip adapters that report enabled=false and
   *  emit a single warning log per run. */
  enabled(): boolean;
  query(q: EngineQuery): Promise<EngineResponse>;
}
