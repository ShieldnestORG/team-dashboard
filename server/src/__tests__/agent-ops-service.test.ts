import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentOpsService } from "../services/agent-ops.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent-ops service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("agent-ops service overview", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-ops-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("does not throw on min(uuid) when an agent has multiple active runs", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    // Two active runs for the same agent forces the groupBy aggregate path
    // (previously `min(heartbeat_runs.id)`, which Postgres rejects for uuid).
    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    await db.insert(heartbeatRuns).values([
      {
        id: firstRunId,
        companyId,
        agentId,
        status: "running",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: secondRunId,
        companyId,
        agentId,
        status: "queued",
        createdAt: new Date("2026-01-01T00:01:00Z"),
      },
    ]);

    const svc = agentOpsService(db);
    const overview = await svc.overview(companyId);

    expect(overview.agents).toHaveLength(1);
    const entry = overview.agents[0];
    expect(entry.activeRunCount).toBe(2);
    // The earliest-created run's id, not an alphabetically-sorted uuid.
    expect(entry.activeRunId).toBe(firstRunId);
  });
});
