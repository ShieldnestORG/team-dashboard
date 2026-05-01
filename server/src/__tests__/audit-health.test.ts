import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

import { auditRoutes } from "../routes/audit.ts";

describe("GET /audit/health", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function buildApp() {
    // Each test gets a fresh router so the in-module 30s cache doesn't carry
    // across tests (the cache is module-scoped, but mocking fetch per-test
    // and using fresh request paths is enough for the assertions we care
    // about — the FIRST call after a fetch swap drives the cache).
    const app = express();
    app.use("/api/public", auditRoutes());
    return app;
  }

  it("returns 200 ok:true when Firecrawl responds 200", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { markdown: "ok", links: [], metadata: {} } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const app = buildApp();
    const res = await request(app).get("/api/public/audit/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 503 ok:false with a reason when Firecrawl errors", async () => {
    // Wait long enough for the previous test's cached result to expire
    // (the cache is module-level). 30s is too long for a unit test, so we
    // bypass it by re-importing the module fresh.
    vi.resetModules();
    const { auditRoutes: freshAuditRoutes } = await import("../routes/audit.ts");

    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const app = express();
    app.use("/api/public", freshAuditRoutes());
    const res = await request(app).get("/api/public/audit/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.reason).toMatch(/firecrawl/i);
  });
});
