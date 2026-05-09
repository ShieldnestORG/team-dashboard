// Re-exports the four v1 engine adapters in deterministic order. The
// watchtower-monitor service iterates this array; ordering is stable so
// that test assertions and the email digest list engines consistently.

export type { EngineAdapter, EngineId, EngineQuery, EngineResponse } from "./types.js";
import type { EngineAdapter } from "./types.js";
import { chatgptAdapter } from "./chatgpt.js";
import { claudeAdapter } from "./claude.js";
import { perplexityAdapter } from "./perplexity.js";
import { geminiAdapter } from "./gemini.js";

export const ALL_ENGINES: ReadonlyArray<EngineAdapter> = [
  chatgptAdapter,
  claudeAdapter,
  perplexityAdapter,
  geminiAdapter,
];
