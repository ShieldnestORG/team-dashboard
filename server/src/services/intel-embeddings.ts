const EMBED_URL = process.env.EMBED_URL || "http://147.79.78.251:8000";
const EMBED_API_KEY = process.env.EMBED_API_KEY || "";

interface EmbeddingResult {
  dense: number[][];
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await fetch(`${EMBED_URL}/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(EMBED_API_KEY ? { "X-API-Key": EMBED_API_KEY } : {}),
    },
    // BGE-M3 via HuggingFace TEI expects `inputs` (string | string[]); see
    // docs/api/intel.md "Vector Search Architecture". Sending `texts` triggers
    // a 422 "missing field `inputs`" from the upstream Rust serde validator.
    body: JSON.stringify({ inputs: texts }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Embedding service error (${res.status}): ${errorText}`);
  }

  // The embedding backend returns either a bare TEI array (`number[][]`) or a
  // legacy `{ dense: number[][] }` wrapper, depending on which server is live.
  // The TEI/BGE-M3 server currently in prod (VPS1) returns the bare array, so
  // reading `data.dense` yields `undefined` and crashes callers on `undefined[0]`.
  // Accept both shapes and fail loud on anything else.
  const data = (await res.json()) as unknown;
  const dense = Array.isArray(data) ? (data as number[][]) : (data as EmbeddingResult | null)?.dense;
  if (!Array.isArray(dense)) {
    throw new Error(
      `Embedding service returned an unexpected shape (expected number[][] or { dense }): ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return dense;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const results = await getEmbeddings([text]);
  const vec = results[0];
  if (!vec) {
    throw new Error("Embedding service returned no vector for the input text");
  }
  return vec;
}
