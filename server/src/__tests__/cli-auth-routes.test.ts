import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalServer } from "./helpers/supertest-server.js";

const mockAccessService = vi.hoisted(() => ({
  isInstanceAdmin: vi.fn(),
  hasPermission: vi.fn(),
  canUser: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockBoardAuthService = vi.hoisted(() => ({
  createCliAuthChallenge: vi.fn(),
  describeCliAuthChallenge: vi.fn(),
  approveCliAuthChallenge: vi.fn(),
  cancelCliAuthChallenge: vi.fn(),
  resolveBoardAccess: vi.fn(),
  resolveBoardActivityCompanyIds: vi.fn(),
  assertCurrentBoardKey: vi.fn(),
  revokeBoardApiKey: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  boardAuthService: () => mockBoardAuthService,
  logActivity: mockLogActivity,
  notifyHireApproved: vi.fn(),
  deduplicateAgentName: vi.fn((name: string) => name),
}));

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  return import("../routes/access.js").then(({ accessRoutes }) =>
    import("../middleware/index.js").then(({ errorHandler }) => {
      app.use(
        "/api",
        accessRoutes({} as any, {
          deploymentMode: "authenticated",
          deploymentExposure: "private",
          bindHost: "127.0.0.1",
          allowedHostnames: [],
        }),
      );
      app.use(errorHandler);
      return app;
    })
  );
}

const local = useLocalServer();

describe("cli auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a CLI auth challenge with approval metadata", async () => {
    mockBoardAuthService.createCliAuthChallenge.mockResolvedValue({
      challenge: {
        id: "challenge-1",
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
      challengeSecret: "pcp_cli_auth_secret",
      pendingBoardToken: "pcp_board_token",
    });

    const app = await createApp({ type: "none", source: "none" });
    const res = await request(local.via(app))
      .post("/api/cli-auth/challenges")
      .send({
        command: "paperclipai company import",
        clientName: "paperclipai cli",
        requestedAccess: "board",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "challenge-1",
      token: "pcp_cli_auth_secret",
      boardApiToken: "pcp_board_token",
      approvalPath: "/cli-auth/challenge-1?token=pcp_cli_auth_secret",
      pollPath: "/cli-auth/challenges/challenge-1",
      expiresAt: "2026-03-23T13:00:00.000Z",
    });
    expect(res.body.approvalUrl).toContain("/cli-auth/challenge-1?token=pcp_cli_auth_secret");
  });

  it("marks challenge status as requiring sign-in for anonymous viewers", async () => {
    mockBoardAuthService.describeCliAuthChallenge.mockResolvedValue({
      id: "challenge-1",
      status: "pending",
      command: "paperclipai company import",
      clientName: "paperclipai cli",
      requestedAccess: "board",
      requestedCompanyId: null,
      requestedCompanyName: null,
      approvedAt: null,
      cancelledAt: null,
      expiresAt: "2026-03-23T13:00:00.000Z",
      approvedByUser: null,
    });

    const app = await createApp({ type: "none", source: "none" });
    const res = await request(local.via(app)).get("/api/cli-auth/challenges/challenge-1?token=pcp_cli_auth_secret");

    expect(res.status).toBe(200);
    expect(res.body.requiresSignIn).toBe(true);
    expect(res.body.canApprove).toBe(false);
  });

  it("approves a CLI auth challenge for a signed-in board user", async () => {
    mockBoardAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved",
      challenge: {
        id: "challenge-1",
        boardApiKeyId: "board-key-1",
        requestedAccess: "board",
        requestedCompanyId: "company-1",
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
      keyExpiresAt: new Date("2026-04-22T13:00:00.000Z"),
    });
    mockBoardAuthService.resolveBoardAccess.mockResolvedValue({
      user: { id: "user-1", name: "User One", email: "user@example.com" },
      companyIds: ["company-1"],
      isInstanceAdmin: false,
    });
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockResolvedValue(["company-1"]);

    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });
    const res = await request(local.via(app))
      .post("/api/cli-auth/challenges/challenge-1/approve")
      .send({ token: "pcp_cli_auth_secret" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      approved: true,
      status: "approved",
      userId: "user-1",
      keyId: "board-key-1",
      expiresAt: "2026-03-23T13:00:00.000Z",
      keyExpiresAt: "2026-04-22T13:00:00.000Z",
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        action: "board_api_key.created",
      }),
    );
  });

  it("logs approve activity for instance admins without company memberships", async () => {
    mockBoardAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved",
      challenge: {
        id: "challenge-2",
        boardApiKeyId: "board-key-2",
        requestedAccess: "instance_admin_required",
        requestedCompanyId: null,
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
    });
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockResolvedValue(["company-a", "company-b"]);

    const app = await createApp({
      type: "board",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [],
    });
    const res = await request(local.via(app))
      .post("/api/cli-auth/challenges/challenge-2/approve")
      .send({ token: "pcp_cli_auth_secret" });

    expect(res.status).toBe(200);
    expect(mockBoardAuthService.resolveBoardActivityCompanyIds).toHaveBeenCalledWith({
      userId: "admin-1",
      requestedCompanyId: null,
      boardApiKeyId: "board-key-2",
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
  });

  it("logs revoke activity with resolved audit company ids", async () => {
    mockBoardAuthService.assertCurrentBoardKey.mockResolvedValue({
      id: "board-key-3",
      userId: "admin-2",
    });
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockResolvedValue(["company-z"]);

    const app = await createApp({
      type: "board",
      userId: "admin-2",
      keyId: "board-key-3",
      source: "board_key",
      isInstanceAdmin: true,
      companyIds: [],
    });
    const res = await request(local.via(app)).post("/api/cli-auth/revoke-current").send({});

    expect(res.status).toBe(200);
    expect(mockBoardAuthService.resolveBoardActivityCompanyIds).toHaveBeenCalledWith({
      userId: "admin-2",
      boardApiKeyId: "board-key-3",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-z",
        action: "board_api_key.revoked",
      }),
    );
  });
  it("threads keyTtlDays through to the service (90-day marketing key mint)", async () => {
    mockBoardAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved",
      challenge: {
        id: "challenge-90",
        boardApiKeyId: "board-key-90",
        requestedAccess: "board",
        requestedCompanyId: null,
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
      keyExpiresAt: new Date("2026-10-02T13:00:00.000Z"),
    });
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockResolvedValue([]);

    const app = await createApp({
      type: "board",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [],
    });
    const res = await request(local.via(app))
      .post("/api/cli-auth/challenges/challenge-90/approve")
      .send({ token: "pcp_cli_auth_secret", keyTtlDays: 90 });

    expect(res.status).toBe(200);
    expect(mockBoardAuthService.approveCliAuthChallenge).toHaveBeenCalledWith(
      "challenge-90",
      "pcp_cli_auth_secret",
      "admin-1",
      { keyTtlDays: 90 },
    );
    expect(res.body.keyExpiresAt).toBe("2026-10-02T13:00:00.000Z");
  });

  it("rejects keyTtlDays above the 90-day cap", async () => {
    const app = await createApp({
      type: "board",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [],
    });
    const res = await request(local.via(app))
      .post("/api/cli-auth/challenges/challenge-x/approve")
      .send({ token: "pcp_cli_auth_secret", keyTtlDays: 91 });

    expect(res.status).toBe(400);
    expect(mockBoardAuthService.approveCliAuthChallenge).not.toHaveBeenCalled();
  });

  it("key-info reports the calling key's expiry and days remaining", async () => {
    const expiresAt = new Date(Date.now() + 14 * 86_400_000);
    mockBoardAuthService.assertCurrentBoardKey.mockResolvedValue({
      id: "board-key-info",
      userId: "user-mkt",
      name: "eagan-claude (board)",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      lastUsedAt: null,
      expiresAt,
    });
    mockBoardAuthService.resolveBoardAccess.mockResolvedValue({
      user: { id: "user-mkt", name: "Eagan", email: "eagan@example.com" },
      companyIds: ["company-1"],
      memberships: [{ companyId: "company-1", role: "marketing" }],
      isInstanceAdmin: false,
    });

    const app = await createApp({
      type: "board",
      userId: "user-mkt",
      keyId: "board-key-info",
      source: "board_key",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });
    const res = await request(local.via(app)).get("/api/cli-auth/key-info");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      keyId: "board-key-info",
      name: "eagan-claude (board)",
      expiresAt: expiresAt.toISOString(),
      daysRemaining: 14,
      userId: "user-mkt",
      isInstanceAdmin: false,
      memberships: [{ companyId: "company-1", role: "marketing" }],
    });
  });

  it("key-info rejects callers that are not using a board API key", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [],
    });
    const res = await request(local.via(app)).get("/api/cli-auth/key-info");
    expect(res.status).toBe(400);
    expect(mockBoardAuthService.assertCurrentBoardKey).not.toHaveBeenCalled();
  });
});
