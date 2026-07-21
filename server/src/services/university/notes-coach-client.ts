// University notes coach — xAI/Grok client. DISABLED by default (gated by UNIVERSITY_COACH_ENABLED + UNIVERSITY_COACH_XAI_KEY). Read-only Q&A; performs NO note writes.
//
// Standalone module — intentionally does NOT import or reuse the Watchtower
// grokAdapter. That adapter is scoped to the Watchtower brand-monitor budget
// and reads WATCHTOWER_GROK_API_KEY (a different budget/key). This coach uses
// its own dedicated key (UNIVERSITY_COACH_XAI_KEY), mirroring the dedicated-key
// isolation used for notes enrichment, so the two spend surfaces never mix.
//
// OpenAI-compatible chat/completions surface. Never throws — safe to call
// directly from an Express handler.

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const TIMEOUT_MS = 30_000;

// Confirm the exact current xAI text model id before enabling.
export const DEFAULT_COACH_MODEL = "grok-4-fast";

/** Whether the dedicated University-coach xAI key is configured (non-empty). */
export function isCoachConfigured(): boolean {
  return typeof process.env.UNIVERSITY_COACH_XAI_KEY === "string"
    && process.env.UNIVERSITY_COACH_XAI_KEY.trim().length > 0;
}

export async function askNotesCoach(args: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<{
  ok: boolean;
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}> {
  const model = args.model ?? DEFAULT_COACH_MODEL;
  const apiKey = process.env.UNIVERSITY_COACH_XAI_KEY?.trim();

  if (!apiKey) {
    return {
      ok: false,
      text: "",
      model,
      inputTokens: 0,
      outputTokens: 0,
      error: "UNIVERSITY_COACH_XAI_KEY missing",
    };
  }

  // 30s cap, plus the caller's own signal if they passed one.
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const signal = args.signal
    ? AbortSignal.any([args.signal, timeoutSignal])
    : timeoutSignal;

  try {
    const res = await fetch(XAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        max_tokens: args.maxTokens ?? 700,
        temperature: 0.3,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        text: "",
        model,
        inputTokens: 0,
        outputTokens: 0,
        error: `HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      ok: true,
      text: data.choices?.[0]?.message?.content ?? "",
      model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      text: "",
      model,
      inputTokens: 0,
      outputTokens: 0,
      error: message,
    };
  }
}
