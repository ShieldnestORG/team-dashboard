// ---------------------------------------------------------------------------
// Fallback embedded-Postgres harness for environments WITHOUT pgvector.
//
// The standard harness (helpers/embedded-postgres.ts → @paperclipai/db) runs
// the FULL production migration chain via applyPendingMigrations(). Two early
// migrations (0060_moltbook_engine, 0064_knowledge_graph) declare
// `embedding vector(1024)` columns that require the pgvector extension. Some
// local/CI machines (and this one) ship an embedded Postgres WITHOUT pgvector,
// so the standard harness marks itself unsupported and dependent tests skip.
//
// This helper lets a test still run end-to-end against a REAL Postgres by
// replaying the SAME migration .sql files in numeric order, applying ONE
// surgical text shim: `vector(N)` → `text`. That shim only touches the two
// unrelated embedding columns; every other table (customer_accounts in 0107,
// university_members / university_subscriptions in 0122, companies/activity_log
// in 0000, the *_subscriptions tables the portal resolver reads) is created
// from its real, unmodified DDL — real CHECK constraints, real unique indexes,
// real foreign keys.
//
// citext / pgcrypto / uuid-ossp ARE available in embedded-postgres (verified),
// so 0107's `CREATE EXTENSION citext` and gen_random_uuid() work as-is.
//
// This is a TEST-ONLY helper. It does not touch production code. It is only
// engaged when getEmbeddedPostgresTestSupport() reports unsupported because of
// pgvector specifically — if Postgres itself can't start, the test still skips.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import {
  createDb,
  ensurePostgresDatabase,
  startEmbeddedPostgresCluster,
  type EmbeddedPostgresCluster,
} from "@paperclipai/db";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../packages/db/src/migrations", import.meta.url),
);

export type NoPgvectorTestDatabase = {
  db: ReturnType<typeof createDb>;
  connectionString: string;
  cleanup(): Promise<void>;
};

// Drizzle splits multi-statement migration files on this marker. Hand-written
// migrations (e.g. 0122) have no marker and are a single chunk.
function splitStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Surgical shim: only the embedding columns. `vector(1024)` → `text`.
function shimPgvector(content: string): string {
  return content.replace(/\bvector\s*\(\s*\d+\s*\)/gi, "text");
}

function listMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // numeric prefixes → lexical sort is the apply order the repo relies on
}

/**
 * Starts embedded Postgres and replays every migration .sql in numeric order
 * with the pgvector shim. Returns a live drizzle db + cleanup.
 */
export async function startNoPgvectorTestDatabase(
  tempDirPrefix: string,
): Promise<NoPgvectorTestDatabase> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), tempDirPrefix));
  let cluster: EmbeddedPostgresCluster | null = null;

  try {
    // Steal-safe startup: initdb first, allocate the port right before
    // postgres binds it, retry on bind conflict (see @paperclipai/db).
    cluster = await startEmbeddedPostgresCluster({
      databaseDir: dataDir,
      user: "paperclip",
      password: "paperclip",
    });
    const { instance, port } = cluster;

    const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
    await ensurePostgresDatabase(adminConnectionString, "paperclip");

    const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
    const db = createDb(connectionString);

    for (const file of listMigrationFiles()) {
      const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const content = shimPgvector(raw);
      for (const statement of splitStatements(content)) {
        await db.execute(sql.raw(statement));
      }
    }

    return {
      db,
      connectionString,
      cleanup: async () => {
        await instance.stop().catch(() => {});
        fs.rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await cluster?.instance.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}
