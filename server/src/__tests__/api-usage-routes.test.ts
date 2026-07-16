import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { apiUsageRoutes } from "../routes/api-usage.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const mockSummarizeApiUsage = vi.hoisted(() => vi.fn());

vi.mock("../services/api-usage.js", () => ({
  summarizeApiUsage: mockSummarizeApiUsage,
}));

function createApp(actorType: "board" | "none" = "board") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: actorType,
      userId: actorType === "board" ? "user-1" : undefined,
      companyIds: actorType === "board" ? ["company-1"] : [],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api/api-usage", apiUsageRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const local = useLocalServer();

describe("api-usage routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /summary returns the rollup for board actors", async () => {
    const summary = {
      todayUsd: 0.12,
      weekUsd: 1.5,
      monthUsd: 4.2,
      byProvider: [
        {
          provider: "anthropic",
          today: { calls: 3, inputTokens: 900, outputTokens: 300, usd: 0.12 },
          week: { calls: 40, inputTokens: 12_000, outputTokens: 4_000, usd: 1.5 },
          month: { calls: 120, inputTokens: 36_000, outputTokens: 12_000, usd: 4.2 },
        },
      ],
      byService: [
        {
          service: "seo-engine",
          today: { calls: 3, inputTokens: 900, outputTokens: 300, usd: 0.12 },
          week: { calls: 40, inputTokens: 12_000, outputTokens: 4_000, usd: 1.5 },
          month: { calls: 120, inputTokens: 36_000, outputTokens: 12_000, usd: 4.2 },
        },
      ],
    };
    mockSummarizeApiUsage.mockResolvedValue(summary);

    const res = await request(local.via(createApp())).get("/api/api-usage/summary");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(summary);
    expect(mockSummarizeApiUsage).toHaveBeenCalledOnce();
  });

  it("GET /summary is board-gated (401 for non-board actors)", async () => {
    const res = await request(local.via(createApp("none"))).get("/api/api-usage/summary");

    expect(res.status).toBe(401);
    expect(mockSummarizeApiUsage).not.toHaveBeenCalled();
  });

  it("GET /summary returns 500 when the rollup query fails", async () => {
    mockSummarizeApiUsage.mockRejectedValue(new Error("db down"));

    const res = await request(local.via(createApp())).get("/api/api-usage/summary");

    expect(res.status).toBe(500);
  });
});
