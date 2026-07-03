// ---------------------------------------------------------------------------
// Cockpit route company-pin tests.
//
// The cockpit reads University-wide data (all university_subscriptions/members +
// the Brevo founding list) that is NOT scoped by the path :companyId. So the
// routes MUST be pinned to the Coherence Daddy / team-dashboard company: a board
// user scoped to a DIFFERENT company passes assertCompanyAccess for their OWN
// companyId, and must still be denied (404) rather than handed CD member PII.
//
// Style mirrors activity-routes.test.ts: express + supertest, req.actor injected
// by a tiny middleware, and the data services fully mocked (no DB, no Brevo).
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

const CD_COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
const OTHER_COMPANY_ID = "00000000-0000-0000-0000-000000000999";
// cockpit.ts reads TEAM_DASHBOARD_COMPANY_ID at module load — set before import.
process.env.TEAM_DASHBOARD_COMPANY_ID = CD_COMPANY_ID;

const mockBrevo = vi.hoisted(() => ({
  getBrevoAccount: vi.fn(),
  getBrevoEmailStats: vi.fn(),
  getBrevoListCount: vi.fn(),
  getBrevoListContacts: vi.fn(),
}));
vi.mock("../services/brevo.js", () => mockBrevo);

const mockMetrics = vi.hoisted(() => ({
  revenueSummary: vi.fn(),
  listMembers: vi.fn(),
}));
vi.mock("../services/cockpit-metrics.js", () => mockMetrics);

import { cockpitRoutes } from "../routes/cockpit.js";

type Actor = Record<string, unknown>;

function createApp(actor: Actor) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", cockpitRoutes({} as any));
  app.use(errorHandler);
  return app;
}

// A board user with access to a NON-CD company only.
const otherCompanyBoardUser: Actor = {
  type: "board",
  userId: "user-other",
  companyIds: [OTHER_COMPANY_ID],
  source: "session",
  isInstanceAdmin: false,
};

// An instance admin (bypasses per-company access) — used for the happy path.
const instanceAdmin: Actor = {
  type: "board",
  userId: "admin",
  companyIds: [],
  source: "session",
  isInstanceAdmin: true,
};

describe("cockpit routes — company pin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 (not CD data) for a board user scoped to another company — revenue", async () => {
    const res = await request(createApp(otherCompanyBoardUser)).get(
      `/api/companies/${OTHER_COMPANY_ID}/cockpit/revenue`,
    );

    expect(res.status).toBe(404);
    expect(mockMetrics.revenueSummary).not.toHaveBeenCalled();
  });

  it("returns 404 (no member PII) for a board user scoped to another company — members", async () => {
    const res = await request(createApp(otherCompanyBoardUser)).get(
      `/api/companies/${OTHER_COMPANY_ID}/cockpit/members`,
    );

    expect(res.status).toBe(404);
    expect(mockMetrics.listMembers).not.toHaveBeenCalled();
    expect(mockBrevo.getBrevoListContacts).not.toHaveBeenCalled();
  });

  it("serves cockpit revenue for the CD company", async () => {
    mockMetrics.revenueSummary.mockResolvedValue({ mrr: 1234 });

    const res = await request(createApp(instanceAdmin)).get(
      `/api/companies/${CD_COMPANY_ID}/cockpit/revenue`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mrr: 1234 });
    expect(mockMetrics.revenueSummary).toHaveBeenCalledTimes(1);
  });
});
