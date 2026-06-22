// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner shared types.
// Persona shapes live in ./personas.ts; these are the runner-internal types.
// ---------------------------------------------------------------------------

export interface ClaudeResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// Closed set — MUST match the CHECK constraint in migration 0127.
export type ReportKind =
  | "auth_failure"
  | "rate_limit"
  | "error"
  | "profanity_block"
  | "incomplete_task"
  | "model_timeout"
  | "bot_challenge"
  | "safety_block"
  | "budget_exceeded";

// MUST match migration 0127's severity CHECK.
export type ReportSeverity = "info" | "warning" | "error" | "critical";

// MUST match migration 0127's purpose CHECK on university_agent_usage.
export type UsagePurpose = "ambient" | "responsive_help" | "variation";

// What the runner does on a tick for one agent.
export type Behavior = "ambient_post" | "ambient_comment" | "responsive_help";
