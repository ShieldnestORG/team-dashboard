import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { applyPendingMigrations, ensurePostgresDatabase } from "./client.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

export type EmbeddedPostgresTestSupport = {
  supported: boolean;
  reason?: string;
};

export type EmbeddedPostgresTestDatabase = {
  connectionString: string;
  cleanup(): Promise<void>;
};

let embeddedPostgresSupportPromise: Promise<EmbeddedPostgresTestSupport> | null = null;

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function formatEmbeddedPostgresError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "embedded Postgres startup failed";
}

export type EmbeddedPostgresCluster = {
  instance: { stop(): Promise<void> };
  port: number;
};

// Postgres cannot listen on port 0, so a free port has to be picked up front —
// and allocate-then-close is inherently racy: another process can bind the
// port between our close and postgres's own bind (the macOS port-steal race).
// Mitigate on both ends: run initdb first (slow, never touches the port) so
// the allocation happens immediately before start(), and when the startup
// logs show a bind conflict, retry on a freshly allocated port.
export async function startEmbeddedPostgresCluster(input: {
  databaseDir: string;
  user: string;
  password: string;
}): Promise<EmbeddedPostgresCluster> {
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const baseOptions = {
    databaseDir: input.databaseDir,
    user: input.user,
    password: input.password,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
    onError: () => {},
  };

  await new EmbeddedPostgres({ ...baseOptions, port: 5432, onLog: () => {} }).initialise();

  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const logs: string[] = [];
    const port = await getAvailablePort();
    const instance = new EmbeddedPostgres({
      ...baseOptions,
      port,
      onLog: (message) => logs.push(String(message)),
    });
    try {
      await instance.start();
      return { instance, port };
    } catch (error) {
      // start() rejects with undefined when postgres exits before becoming
      // ready — the actual reason only shows up in the captured log lines.
      lastError =
        error ?? new Error(logs.join("").trim() || "embedded Postgres startup failed");
      // The postgres process is already dead here. stop() would hang waiting
      // for an 'exit' event that has already fired, and the package's exit
      // hook calls stop() on every instance it ever constructed — clear the
      // dead process handle so both become no-ops.
      (instance as unknown as { process?: unknown }).process = undefined;
      const bindConflict = logs.some((line) =>
        /address already in use|could not bind/i.test(line),
      );
      if (!bindConflict) break;
      console.warn(
        `[embedded-postgres] port ${port} was stolen before postgres could bind (attempt ${attempt}/${maxAttempts}); retrying on a fresh port`,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(formatEmbeddedPostgresError(lastError));
}

async function probeEmbeddedPostgresSupport(): Promise<EmbeddedPostgresTestSupport> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-embedded-postgres-probe-"));
  let cluster: EmbeddedPostgresCluster | null = null;

  try {
    cluster = await startEmbeddedPostgresCluster({
      databaseDir: dataDir,
      user: "paperclip",
      password: "paperclip",
    });

    // The migration chain depends on the pgvector extension (vector(1024)
    // columns in 0060 / 0064). embedded-postgres does not bundle pgvector,
    // so probe for it here and mark the environment unsupported if missing
    // — dependent tests will skip cleanly instead of failing loudly during
    // applyPendingMigrations.
    const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${cluster.port}/postgres`;
    const sql = postgres(adminConnectionString, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe("CREATE EXTENSION IF NOT EXISTS vector");
    } catch (error) {
      return {
        supported: false,
        reason: `pgvector extension unavailable in embedded Postgres: ${formatEmbeddedPostgresError(error)}`,
      };
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }

    return { supported: true };
  } catch (error) {
    return {
      supported: false,
      reason: formatEmbeddedPostgresError(error),
    };
  } finally {
    await cluster?.instance.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

export async function getEmbeddedPostgresTestSupport(): Promise<EmbeddedPostgresTestSupport> {
  if (!embeddedPostgresSupportPromise) {
    embeddedPostgresSupportPromise = probeEmbeddedPostgresSupport();
  }
  return await embeddedPostgresSupportPromise;
}

export async function startEmbeddedPostgresTestDatabase(
  tempDirPrefix: string,
): Promise<EmbeddedPostgresTestDatabase> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), tempDirPrefix));
  let cluster: EmbeddedPostgresCluster | null = null;

  try {
    cluster = await startEmbeddedPostgresCluster({
      databaseDir: dataDir,
      user: "paperclip",
      password: "paperclip",
    });

    const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${cluster.port}/postgres`;
    await ensurePostgresDatabase(adminConnectionString, "paperclip");
    const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${cluster.port}/paperclip`;
    await applyPendingMigrations(connectionString);

    const { instance } = cluster;
    return {
      connectionString,
      cleanup: async () => {
        await instance.stop().catch(() => {});
        fs.rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await cluster?.instance.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw new Error(
      `Failed to start embedded PostgreSQL test database: ${formatEmbeddedPostgresError(error)}`,
    );
  }
}
