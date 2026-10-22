// ---------------------------------------------------------------------------
// Database round trips per request, for the hottest agent path.
//
// Production's database (Neon, us-east-1) is 55 ms from the app on VPS4
// (measured 2026-10-21). Each drizzle query with parameters costs TWO round
// trips there: drizzle runs every query through postgres.js `unsafe()`, which
// is unprepared, so postgres.js describes the statement and waits before it
// binds it. So a request's time is set by how many queries it waits for one
// after another, not by the queries themselves (the issue list executes in
// 0.24 ms on Neon).
//
// These tests put a latency proxy in front of embedded Postgres and pin that
// count for bearer agent-key auth and GET /companies/:id/issues, which Agent
// Ops' `tix ls` calls at every Claude session start on the owner's Mac.
// Set DB_RTT_MS=55 to reproduce production's distance; the default (100 ms)
// keeps the margins wide on a busy machine.
//
// The migrations need pgvector, which embedded Postgres lacks, so on most
// machines this suite skips like the other embedded-Postgres suites. To run
// it, point ROUND_TRIPS_PG_URL at any Postgres with pgvector (a throwaway
// `pgvector/pgvector:pg17` container); the suite makes its own database there.
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  agentApiKeys,
  agents,
  applyPendingMigrations,
  authUsers,
  boardApiKeys,
  companies,
  companyMemberships,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issueLabels,
  issues,
  labels,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startLatencyProxy } from "./helpers/latency-proxy.js";
import { useLocalServer } from "./helpers/supertest-server.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { issueService } from "../services/issues.js";

const externalAdminUrl = process.env.ROUND_TRIPS_PG_URL?.trim() || null;
const embeddedPostgresSupport = externalAdminUrl
  ? { supported: true as const }
  : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres round-trip tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/** A fresh, migrated database on an outside Postgres server that has pgvector. */
async function startExternalTestDatabase(adminUrl: string) {
  const name = `paperclip_rt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await ensurePostgresDatabase(adminUrl, name);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const connectionString = url.toString();
  const setup = createDb(connectionString);
  await setup.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await setup.$client.end();
  await applyPendingMigrations(connectionString);
  return {
    connectionString,
    cleanup: async () => {
      const admin = createDb(adminUrl);
      await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).catch(() => {});
      await admin.$client.end();
    },
  };
}

const RTT_MS = Number(process.env.DB_RTT_MS ?? 100);

const COMPANY_ID = randomUUID();
const AGENT_ID = randomUUID();
const TERMINATED_AGENT_ID = randomUUID();
const PENDING_AGENT_ID = randomUUID();
const USER_ID = `user-${randomUUID()}`;
const LABEL_ID = randomUUID();
const UNUSED_LABEL_ID = randomUUID();
const RUN_ID = randomUUID();

const AGENT_TOKEN = `pcp_${"a".repeat(48)}`;
const REVOKED_TOKEN = `pcp_${"b".repeat(48)}`;
const TERMINATED_TOKEN = `pcp_${"c".repeat(48)}`;
const PENDING_TOKEN = `pcp_${"d".repeat(48)}`;
const BOARD_TOKEN = `pcp_board_${"e".repeat(48)}`;
const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

function agentRow(id: string, status: string) {
  return {
    id,
    companyId: COMPANY_ID,
    name: `agent-${id.slice(0, 8)}`,
    role: "engineer",
    status,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
  };
}

function actorApp(db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
  app.get("/whoami", (req, res) => res.json(req.actor));
  return app;
}

function issuesApp(db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(express.json());
  app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
  app.use("/api", issueRoutes(db, {} as never));
  app.use(errorHandler);
  return app;
}

async function median(times: number, fn: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

describeEmbeddedPostgres("bearer auth and the issue list against a remote database", () => {
  const local = useLocalServer();
  let tempDb: { connectionString: string; cleanup: () => Promise<void> } | null = null;
  let proxy: Awaited<ReturnType<typeof startLatencyProxy>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let remoteDb!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = externalAdminUrl
      ? await startExternalTestDatabase(externalAdminUrl)
      : await startEmbeddedPostgresTestDatabase("paperclip-db-round-trips-");
    db = createDb(tempDb.connectionString);
    const url = new URL(tempDb.connectionString);
    proxy = await startLatencyProxy({ host: url.hostname, port: Number(url.port) }, RTT_MS / 2);
    url.port = String(proxy.port);
    remoteDb = createDb(url.toString());

    await db.insert(companies).values({
      id: COMPANY_ID,
      name: "Round Trips",
      issuePrefix: `R${COMPANY_ID.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      agentRow(AGENT_ID, "active"),
      agentRow(TERMINATED_AGENT_ID, "terminated"),
      agentRow(PENDING_AGENT_ID, "pending_approval"),
    ]);
    await db.insert(agentApiKeys).values([
      { agentId: AGENT_ID, companyId: COMPANY_ID, name: "live", keyHash: sha256(AGENT_TOKEN) },
      {
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        name: "revoked",
        keyHash: sha256(REVOKED_TOKEN),
        revokedAt: new Date(),
      },
      { agentId: TERMINATED_AGENT_ID, companyId: COMPANY_ID, name: "t", keyHash: sha256(TERMINATED_TOKEN) },
      { agentId: PENDING_AGENT_ID, companyId: COMPANY_ID, name: "p", keyHash: sha256(PENDING_TOKEN) },
    ]);
    const now = new Date();
    await db.insert(authUsers).values({
      id: USER_ID,
      name: "Owner",
      email: "owner@example.com",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companyMemberships).values({
      companyId: COMPANY_ID,
      principalType: "user",
      principalId: USER_ID,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(boardApiKeys).values({ userId: USER_ID, name: "cli", keyHash: sha256(BOARD_TOKEN) });

    await db.insert(heartbeatRuns).values({ id: RUN_ID, companyId: COMPANY_ID, agentId: AGENT_ID, status: "running" });
    await db.insert(labels).values([
      { id: LABEL_ID, companyId: COMPANY_ID, name: "project:Agent Ops", color: "#ffffff" },
      { id: UNUSED_LABEL_ID, companyId: COMPANY_ID, name: "project:nowhere", color: "#000000" },
    ]);
    const openIssues = Array.from({ length: 4 }, (_, i) => ({
      id: randomUUID(),
      companyId: COMPANY_ID,
      title: `Open issue ${i}`,
      status: i === 3 ? "blocked" : "todo",
      priority: "medium",
      executionRunId: i === 0 ? RUN_ID : null,
    }));
    await db.insert(issues).values([
      ...openIssues,
      { id: randomUUID(), companyId: COMPANY_ID, title: "Done issue", status: "done", priority: "low" },
    ]);
    await db.insert(issueLabels).values(
      openIssues.slice(0, 2).map((row) => ({ issueId: row.id, labelId: LABEL_ID, companyId: COMPANY_ID })),
    );

    // Open several connections up front, as production's pool has them, so a
    // parallel query never waits for a new connection.
    await Promise.all(Array.from({ length: 6 }, () => remoteDb.execute(sql`select 1`)));
  }, 60_000);

  afterAll(async () => {
    await proxy?.close();
    await tempDb?.cleanup();
  });

  describe("behaviour is unchanged", () => {
    it("an agent key resolves to its agent and records lastUsedAt", async () => {
      await db.update(agentApiKeys).set({ lastUsedAt: null }).where(sql`${agentApiKeys.name} = 'live'`);
      const res = await request(local.via(actorApp(db)))
        .get("/whoami")
        .set("Authorization", `Bearer ${AGENT_TOKEN}`)
        .set("X-Paperclip-Run-Id", "run-42");
      expect(res.body).toMatchObject({
        type: "agent",
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        runId: "run-42",
        source: "agent_key",
      });
      expect(typeof res.body.keyId).toBe("string");

      // The write no longer holds the request, so wait for it to land.
      let lastUsedAt: Date | null = null;
      for (let i = 0; i < 50 && !lastUsedAt; i++) {
        const [row] = await db
          .select({ lastUsedAt: agentApiKeys.lastUsedAt })
          .from(agentApiKeys)
          .where(sql`${agentApiKeys.name} = 'live'`);
        lastUsedAt = row?.lastUsedAt ?? null;
        if (!lastUsedAt) await new Promise((r) => setTimeout(r, 20));
      }
      expect(lastUsedAt).toBeInstanceOf(Date);
    });

    it.each([
      ["a revoked key", REVOKED_TOKEN],
      ["a terminated agent's key", TERMINATED_TOKEN],
      ["a pending agent's key", PENDING_TOKEN],
      ["an unknown token", `pcp_${"f".repeat(48)}`],
    ])("%s resolves to no actor", async (_name, token) => {
      const res = await request(local.via(actorApp(db))).get("/whoami").set("Authorization", `Bearer ${token}`);
      expect(res.body).toMatchObject({ type: "none" });
    });

    it("a board key still wins and resolves to its user", async () => {
      const res = await request(local.via(actorApp(db))).get("/whoami").set("Authorization", `Bearer ${BOARD_TOKEN}`);
      expect(res.body).toMatchObject({
        type: "board",
        userId: USER_ID,
        companyIds: [COMPANY_ID],
        source: "board_key",
      });
    });

    it("the list keeps labels and active runs, and filters by labelId", async () => {
      const svc = issueService(db);
      const open = await svc.list(COMPANY_ID, { status: "todo,in_progress,blocked" });
      expect(open).toHaveLength(4);
      expect(open.filter((row) => row.labels.length === 1)).toHaveLength(2);
      expect(open.filter((row) => row.activeRun?.id === RUN_ID)).toHaveLength(1);

      const labeled = await svc.list(COMPANY_ID, { status: "todo,in_progress,blocked", labelId: LABEL_ID });
      expect(labeled).toHaveLength(2);
      expect(labeled.every((row) => row.labelIds.includes(LABEL_ID))).toBe(true);

      expect(await svc.list(COMPANY_ID, { labelId: UNUSED_LABEL_ID })).toEqual([]);
    });
  });

  describe(`round trips with the database ${RTT_MS} ms away`, () => {
    it("agent-key auth waits for one database turn, not four", async () => {
      const app = actorApp(remoteDb);
      const call = () => request(local.via(app)).get("/whoami").set("Authorization", `Bearer ${AGENT_TOKEN}`);
      await call();
      const ms = await median(3, call);
      console.log(`[round-trips] agent-key auth: ${ms.toFixed(0)} ms = ${(ms / RTT_MS).toFixed(1)} RTT`);
      // One wave of describe-then-bind queries is 2 RTT; four in a row was 8.
      expect(ms).toBeLessThan(4 * RTT_MS);
    }, 60 * RTT_MS);

    it("board-key auth no longer waits for the lastUsedAt write", async () => {
      const app = actorApp(remoteDb);
      const call = () => request(local.via(app)).get("/whoami").set("Authorization", `Bearer ${BOARD_TOKEN}`);
      await call();
      const ms = await median(3, call);
      console.log(`[round-trips] board-key auth: ${ms.toFixed(0)} ms = ${(ms / RTT_MS).toFixed(1)} RTT`);
      // key lookups 2 + access 2 = 4 RTT; it was key 2 + access 2 + touch 2 = 6.
      expect(ms).toBeLessThan(5 * RTT_MS);
    }, 60 * RTT_MS);

    it("GET /companies/:id/issues (tix ls) waits for three database turns", async () => {
      const app = issuesApp(remoteDb);
      const call = async () => {
        const res = await request(local.via(app))
          .get(`/api/companies/${COMPANY_ID}/issues?status=todo,in_progress,blocked`)
          .set("Authorization", `Bearer ${AGENT_TOKEN}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(4);
      };
      await call();
      const ms = await median(3, call);
      console.log(`[round-trips] GET issues (auth + list): ${ms.toFixed(0)} ms = ${(ms / RTT_MS).toFixed(1)} RTT`);
      // auth 2 + issues 2 + (labels with runs) 2 = 6 RTT; it was 8 + 2 + 2 + 2 = 14.
      expect(ms).toBeLessThan(8 * RTT_MS);
    }, 60 * RTT_MS);

    it("a labelId filter does not add a database turn", async () => {
      const svc = issueService(remoteDb);
      const call = () => svc.list(COMPANY_ID, { status: "todo,in_progress,blocked", labelId: LABEL_ID });
      await call();
      const ms = await median(3, call);
      console.log(`[round-trips] list with labelId: ${ms.toFixed(0)} ms = ${(ms / RTT_MS).toFixed(1)} RTT`);
      // issues 2 + (labels with runs) 2 = 4 RTT; it was ids 2 + issues 2 + labels 2 + runs 2 = 8.
      expect(ms).toBeLessThan(5 * RTT_MS);
    }, 60 * RTT_MS);
  });
});
