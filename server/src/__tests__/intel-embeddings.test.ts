import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// intel-embeddings — wire-protocol regression test.
//
// The upstream embedding service (BGE-M3 via HuggingFace text-embeddings-
// inference, see docs/api/intel.md "Vector Search Architecture") validates
// its JSON body with Rust serde and requires the field name `inputs`.
// A previous shape sent `{ texts: [...] }`, which produced repeated
//   "Embedding service error (422): Failed to deserialize the JSON body into
//    the target type: missing field `inputs`"
// log entries on prod (VPS4) several times an hour. This test pins the
// outgoing request body so the regression cannot return.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("intel-embeddings request body", () => {
  it("getEmbeddings POSTs JSON body with non-empty `inputs` field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ dense: [[0.1, 0.2, 0.3]] }));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    await getEmbeddings(["hello world"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");

    const body = JSON.parse(String(init?.body));
    expect(body).toHaveProperty("inputs");
    expect(body.inputs).toEqual(["hello world"]);
    expect(body).not.toHaveProperty("texts");
  });

  it("getEmbedding (single) flows the string through `inputs` as a one-element array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ dense: [[0.4, 0.5, 0.6]] }));

    const { getEmbedding } = await import("../services/intel-embeddings.js");
    const vec = await getEmbedding("a single query");

    expect(vec).toEqual([0.4, 0.5, 0.6]);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.inputs).toEqual(["a single query"]);
  });

  it("returns [] without calling fetch for an empty batch", async () => {
    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    const out = await getEmbeddings([]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Response-shape regression: the live TEI/BGE-M3 backend (VPS1, port 8080)
  // returns a BARE `number[][]` array, not the `{ dense }` wrapper the code
  // originally assumed. Reading `data.dense` yielded undefined and crashed
  // every caller on `undefined[0]` — silent for weeks on prod ("TypeError:
  // Cannot read properties of undefined (reading '0')" at getEmbedding,
  // ~150/hr, embeddings stored NULL). These pin BOTH accepted shapes + the
  // fail-loud path so the silent-NULL regression cannot return.
  // -------------------------------------------------------------------------
  it("getEmbeddings handles a bare TEI array response (number[][])", async () => {
    fetchMock.mockResolvedValue(jsonResponse([[0.1, 0.2, 0.3]]));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    const out = await getEmbeddings(["hello world"]);
    expect(out).toEqual([[0.1, 0.2, 0.3]]);
  });

  it("getEmbedding returns the vector from a bare TEI array response", async () => {
    fetchMock.mockResolvedValue(jsonResponse([[0.7, 0.8, 0.9]]));

    const { getEmbedding } = await import("../services/intel-embeddings.js");
    const vec = await getEmbedding("a single query");
    expect(vec).toEqual([0.7, 0.8, 0.9]);
  });

  it("still accepts the legacy { dense } wrapper shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ dense: [[1, 2, 3]] }));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    const out = await getEmbeddings(["x"]);
    expect(out).toEqual([[1, 2, 3]]);
  });

  it("throws a clear error (not undefined[0]) on an unexpected response shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    await expect(getEmbeddings(["x"])).rejects.toThrow(/unexpected shape/i);
  });
});

// ---------------------------------------------------------------------------
// Resilience: transient embedding failures (TEI restarts, Tailnet blips) had
// been hard-failing the embed crons with a bare "fetch failed" because
// getEmbeddings did one fetch with no timeout and no retry. These pin the
// retry-on-transient / surface-permanent-immediately behavior.
// ---------------------------------------------------------------------------
describe("intel-embeddings resilience (retry + timeout)", () => {
  it("retries a transient network failure ('fetch failed') then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse([[0.1, 0.2]]));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    const out = await getEmbeddings(["x"]);

    expect(out).toEqual([[0.1, 0.2]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient 5xx (TEI restarting) then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "restarting" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([[0.3]]));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    const out = await getEmbeddings(["x"]);

    expect(out).toEqual([[0.3]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a permanent 4xx (e.g. 422 bad body) — surfaces immediately", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "missing field `inputs`" }, { status: 422 }),
    );

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    await expect(getEmbeddings(["x"])).rejects.toThrow(/422/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry an unexpected-shape error (our own thrown Error)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    await expect(getEmbeddings(["x"])).rejects.toThrow(/unexpected shape/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries on a persistent network failure (1 + 2 retries = 3 calls)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { getEmbeddings } = await import("../services/intel-embeddings.js");
    await expect(getEmbeddings(["x"])).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
