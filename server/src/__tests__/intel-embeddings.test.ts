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
});
