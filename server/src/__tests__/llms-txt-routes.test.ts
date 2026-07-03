/**
 * Route tests for /api/llms-txt.
 *
 * We mock the generator service to avoid network I/O, then poke a thin db
 * stub that supports the .select().from().where().limit() chain used by
 * the GET endpoints.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// Service mock — captures call args + returns a deterministic jobId.
const generateForDomain = vi.fn(async (_domain: string, _opts: any) => ({ jobId: "job-123" }));

vi.mock("../services/llms-txt-generator.ts", async () => {
  const actual = await vi.importActual<typeof import("../services/llms-txt-generator.ts")>(
    "../services/llms-txt-generator.ts",
  );
  return {
    ...actual,
    llmsTxtGenerator: () => ({ generateForDomain }),
  };
});

import { llmsTxtRoutes } from "../routes/llms-txt.ts";
import { useLocalServer } from "./helpers/supertest-server.js";

function buildApp(jobs: any[] = [], outputs: any[] = []) {
  const db: any = {
    select(cols?: any) {
      // Track which "table" the chain targets via the next .from() call.
      let targetTable: "jobs" | "outputs" = "jobs";
      let _selectedCols = cols;
      const chain = {
        from(table: any) {
          // Crude discriminator: schema objects expose `_.name` via drizzle,
          // but we don't need to be exact — outputs is queried only after
          // jobs in the route, so we use a counter on the closure.
          if (table && typeof table === "object" && "jobId" in table) {
            targetTable = "outputs";
          } else {
            targetTable = "jobs";
          }
          return chain;
        },
        where(_cond: any) {
          return chain;
        },
        limit(_n: number) {
          return Promise.resolve(targetTable === "jobs" ? jobs : outputs);
        },
      };
      return chain;
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/llms-txt", llmsTxtRoutes(db));
  return app;
}

const local = useLocalServer();

beforeEach(() => {
  generateForDomain.mockClear();
  generateForDomain.mockResolvedValue({ jobId: "job-123" });
});

describe("POST /api/llms-txt/generate", () => {
  it("returns 400 when domain is missing", async () => {
    const res = await request(local.via(buildApp())).post("/api/llms-txt/generate").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither accountId nor email provided", async () => {
    const res = await request(local.via(buildApp()))
      .post("/api/llms-txt/generate")
      .send({ domain: "example.com" });
    expect(res.status).toBe(400);
  });

  it("returns 202 + jobId when given domain + email", async () => {
    const res = await request(local.via(buildApp()))
      .post("/api/llms-txt/generate")
      .send({ domain: "example.com", email: "a@b.co" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: "job-123" });
    expect(generateForDomain).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ accountId: undefined, sitemapUrl: undefined }),
    );
  });

  it("passes accountId + sitemapUrl through", async () => {
    const res = await request(local.via(buildApp()))
      .post("/api/llms-txt/generate")
      .send({
        domain: "https://example.com",
        accountId: "acc-1",
        sitemapUrl: "https://example.com/custom.xml",
      });
    expect(res.status).toBe(202);
    expect(generateForDomain).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        accountId: "acc-1",
        sitemapUrl: "https://example.com/custom.xml",
      }),
    );
  });
});

describe("GET /api/llms-txt/jobs/:id", () => {
  it("returns 404 when job not found", async () => {
    const res = await request(local.via(buildApp([]))).get("/api/llms-txt/jobs/missing");
    expect(res.status).toBe(404);
  });

  it("reflects job status when present", async () => {
    const job = {
      id: "job-1",
      domain: "https://example.com",
      status: "queued",
      requestedAt: new Date("2026-05-09T00:00:00Z"),
      completedAt: null,
      error: null,
    };
    const res = await request(local.via(buildApp([job]))).get("/api/llms-txt/jobs/job-1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("queued");
    expect(res.body.pageCount).toBeNull();
  });
});
