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
    body: JSON.stringify({ texts }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Embedding service error (${res.status}): ${errorText}`);
  }

  const data: EmbeddingResult = await res.json();
  return data.dense;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const results = await getEmbeddings([text]);
  return results[0];
}
