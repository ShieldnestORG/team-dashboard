/**
 * Seed Rizz Agent — 2026-04-28
 *
 * Inserts the Rizz agent record in the agents table so that
 * `seedManagedInstructionsFromRepo()` will pick him up on next server
 * startup and materialize `agents/rizz/AGENTS.md` into his managed
 * instructions bundle.
 *
 * Rizz is a top-level agent (peer to Atlas, not a report). He owns the
 * Rizz brand surface — public-facing TikTok content reviewer.
 *
 * Idempotent: checks for an existing agent named "Rizz" in the same
 * company first, skips if present.
 *
 * Usage:
 *   cd server && npx tsx scripts/seed-rizz-agent-2026-04-28.ts
 *
 * Requires DATABASE_URL and TEAM_DASHBOARD_COMPANY_ID (or the fallback
 * baked in below).
 */

import { and, eq } from "drizzle-orm";
import { agents, createDb } from "@paperclipai/db";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ??
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const RIZZ_AGENT_NAME = "Rizz";

// adapterConfig tells `seedManagedInstructionsFromRepo()` to look for
// `agents/rizz/AGENTS.md` and materialize it into the managed bundle.
const RIZZ_ADAPTER_CONFIG = {
  instructionsBundleMode: "managed" as const,
  instructionsEntryFile: "AGENTS.md",
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createDb(url);

  const existing = await db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, COMPANY_ID), eq(agents.name, RIZZ_AGENT_NAME)))
    .then((rows) => rows[0] ?? null);

  if (existing) {
    console.log(`✓ Agent "${RIZZ_AGENT_NAME}" already exists (id=${existing.id}). Skipping.`);
    process.exit(0);
  }

  const [inserted] = await db
    .insert(agents)
    .values({
      companyId: COMPANY_ID,
      name: RIZZ_AGENT_NAME,
      role: "general",
      title: "TikTok Content Reviewer (AI Character)",
      status: "idle",
      reportsTo: null, // top-level: peer to Atlas, reports to the board
      adapterType: "process",
      adapterConfig: RIZZ_ADAPTER_CONFIG,
      // Modest starting budget; raise via the dashboard once review volume justifies.
      budgetMonthlyCents: 5000,
    })
    .returning();

  console.log(`✓ Inserted Rizz agent (id=${inserted!.id})`);
  console.log("  → On next server restart, agents/rizz/AGENTS.md will be");
  console.log("    materialized into Rizz's managed instructions bundle.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
