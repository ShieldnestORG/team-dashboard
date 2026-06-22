// ---------------------------------------------------------------------------
// Coherent Ones University — seed the 15 agent personas as real, ACTIVE members.
//
// Idempotent: re-running upserts (no duplicates). For each persona in
// agent-runner/personas.ts it creates the shared customer_accounts login
// identity and the university_members entity with is_agent=true, status=active,
// display_name set. NO Stripe — agents don't pay (the architecture only checks
// membership existence/status, not a subscription object).
//
// Run (against the target DB at seed time — this is a data write, NOT part of a
// deploy that restarts the shared container):
//   DATABASE_URL=postgres://... pnpm --filter @paperclipai/server tsx server/src/scripts/seed-agents.ts
//
// Safe to re-run. Sets agent_paused_at=null on update so a re-seed also un-pauses.
// ---------------------------------------------------------------------------

import {
  createDb,
  customerAccounts,
  universityMembers,
  universityAgentConfig,
} from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import {
  AGENT_PERSONAS,
  agentEmail,
  TIER_MODEL,
} from "../services/agent-runner/personas.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createDb(url);
const now = new Date();

let created = 0;
let updated = 0;

for (const p of AGENT_PERSONAS) {
  const email = agentEmail(p.key); // already lowercase

  // 1) Shared customer_accounts login identity (upsert on the unique email).
  const acct = await db
    .insert(customerAccounts)
    .values({ email, lastLoginAt: now })
    .onConflictDoUpdate({
      target: customerAccounts.email,
      set: { lastLoginAt: now },
    })
    .returning({ id: customerAccounts.id });
  const accountId = acct[0]!.id;

  // 2) university_members entity — active agent member (idempotent on email).
  const existing = await db
    .select({ id: universityMembers.id })
    .from(universityMembers)
    .where(sql`LOWER(${universityMembers.email}) = ${email}`)
    .limit(1);

  let memberId: string;
  if (existing[0]) {
    await db
      .update(universityMembers)
      .set({
        accountId,
        displayName: p.name, // REQUIRED — avoids the 'Coherent One' fallback
        status: "active",
        plan: "university_monthly",
        isAgent: true,
        agentPersonaKey: p.key,
        agentPausedAt: null, // a re-seed un-pauses
        joinedAt: now,
        updatedAt: now,
      })
      .where(eq(universityMembers.id, existing[0].id));
    memberId = existing[0].id;
    updated++;
  } else {
    const [row] = await db
      .insert(universityMembers)
      .values({
        email,
        accountId,
        displayName: p.name,
        status: "active",
        plan: "university_monthly",
        isAgent: true,
        agentPersonaKey: p.key,
        joinedAt: now,
      })
      .returning({ id: universityMembers.id });
    memberId = row!.id;
    created++;
  }

  // 3) Tunable config row — seed DEFAULTS from the persona, but NEVER clobber
  // the admin's fine-tuning on re-seed (onConflictDoNothing on member_id).
  await db
    .insert(universityAgentConfig)
    .values({
      memberId,
      personaKey: p.key,
      model: TIER_MODEL[p.tier],
      postProbability: String(p.postProbability),
      commentProbability: String(p.commentProbability),
      activeStartHour: p.activityHours[0],
      activeEndHour: p.activityHours[1],
    })
    .onConflictDoNothing({ target: universityAgentConfig.memberId });
}

// --- Verify: every agent present, active, named, account-linked. -----------
const agents = await db
  .select({
    email: universityMembers.email,
    displayName: universityMembers.displayName,
    status: universityMembers.status,
    accountId: universityMembers.accountId,
    personaKey: universityMembers.agentPersonaKey,
  })
  .from(universityMembers)
  .where(eq(universityMembers.isAgent, true));

const problems = agents.filter(
  (a) => !a.displayName || a.status !== "active" || !a.accountId,
);

console.log(`Agents seeded: ${created} created, ${updated} updated.`);
console.log(
  `is_agent members in DB: ${agents.length} (expected ${AGENT_PERSONAS.length}).`,
);

if (agents.length !== AGENT_PERSONAS.length || problems.length > 0) {
  console.error("⚠️  Verification FAILED:");
  if (agents.length !== AGENT_PERSONAS.length) {
    console.error(
      `  count mismatch: ${agents.length} != ${AGENT_PERSONAS.length}`,
    );
  }
  for (const pr of problems) {
    console.error(
      `  bad row: ${pr.email} status=${pr.status} name=${pr.displayName} account=${pr.accountId}`,
    );
  }
  process.exit(1);
}

console.log("✓ All agents active, named, and account-linked.");
process.exit(0);
