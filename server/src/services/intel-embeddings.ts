// VPS1 `shield-llm` BGE-M3 over the Tailnet (HuggingFace TEI, Tailnet-only, no
// public bind). Prod sets EMBED_URL explicitly; the default is the live VPS1
// host. NEVER default to the pre-2026-05-09 VPS3 host (http://147.79.78.251:8000)
// again — that box was decommissioned after the 2026-05-08 compromise and
// pointing at it produces silent "fetch failed" errors on every embedding cron.
const EMBED_URL = process.env.EMBED_URL || "http://100.67.128.51:8080";
const EMBED_API_KEY = process.env.EMBED_API_KEY || "";

// Per-attempt timeout. Real cron batches are tiny (2–6 texts, sub-second) but a
// backlog can send up to 100 texts and the CPU TEI takes ~20s for 32 — so the
// cap must be generous enough not to sever a legitimate large batch. It exists
// to fail a truly hung socket, not to bound normal latency.
const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS) || 120_000;
const EMBED_MAX_RETRIES = 2;

interface EmbeddingResult {
  dense: number[][];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Network-level fetch failures (undici "fetch failed" → TypeError; an
// AbortSignal timeout → TimeoutError) are transient: the TEI container restarts
// and the Tailnet occasionally blips for a few minutes (a separate monitor
// alerts and auto-recovers). These were the recurring "fetch failed" cron
// errors. Our OWN thrown Errors ("Embedding service error (…)", "unexpected
// shape") are plain Error, so they are not treated as transient and surface
// immediately without burning retries.
function isTransientFetchError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // undici network failure
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  let lastErr: unknown;
  for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * attempt); // 500ms, then 1000ms backoff

    try {
      const res = await fetch(`${EMBED_URL}/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(EMBED_API_KEY ? { Authorization: `Bearer ${EMBED_API_KEY}` } : {}),
        },
        // BGE-M3 via HuggingFace TEI expects `inputs` (string | string[]); see
        // docs/api/intel.md "Vector Search Architecture". Sending `texts`
        // triggers a 422 "missing field `inputs`" from the Rust serde validator.
        body: JSON.stringify({ inputs: texts }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        // Retry transient upstream states (5xx during a TEI restart, 429
        // backpressure); surface permanent 4xx (e.g. 422 bad body) at once.
        if ((res.status >= 500 || res.status === 429) && attempt < EMBED_MAX_RETRIES) {
          lastErr = new Error(`Embedding service error (${res.status}): ${errorText}`);
          continue;
        }
        throw new Error(`Embedding service error (${res.status}): ${errorText}`);
      }

      // The embedding backend returns either a bare TEI array (`number[][]`) or a
      // legacy `{ dense: number[][] }` wrapper, depending on which server is live.
      // The TEI/BGE-M3 server currently in prod (VPS1) returns the bare array, so
      // reading `data.dense` yields `undefined` and crashes callers on
      // `undefined[0]`. Accept both shapes and fail loud on anything else.
      const data = (await res.json()) as unknown;
      const dense = Array.isArray(data) ? (data as number[][]) : (data as EmbeddingResult | null)?.dense;
      if (!Array.isArray(dense)) {
        throw new Error(
          `Embedding service returned an unexpected shape (expected number[][] or { dense }): ${JSON.stringify(data).slice(0, 200)}`,
        );
      }
      return dense;
    } catch (err) {
      lastErr = err;
      if (isTransientFetchError(err) && attempt < EMBED_MAX_RETRIES) {
        continue; // transient network/timeout — retry with backoff
      }
      throw err;
    }
  }

  // Unreachable in practice (every path above returns or throws); satisfies the
  // control-flow analysis and re-surfaces the last transient error if it isn't.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getEmbedding(text: string): Promise<number[]> {
  const results = await getEmbeddings([text]);
  const vec = results[0];
  if (!vec) {
    throw new Error("Embedding service returned no vector for the input text");
  }
  return vec;
}
