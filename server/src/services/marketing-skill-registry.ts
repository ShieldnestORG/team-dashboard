// ---------------------------------------------------------------------------
// Marketing Skill Registry — single source of truth for which marketing
// agent owns which channel/skill across the Coherence Daddy ecosystem.
//
// Track C plan (approved): four marketing agents, one per product surface
// plus the umbrella feed. Each skill has exactly ONE owner; readers may
// observe but never publish.
//
//  - beacon  — Umbrella feed for coherencedaddy.com (cross-product blog,
//              umbrella socials, paid-ads creative umbrella).
//  - ledger  — Off-site marketing distribution for CreditScore (planned;
//              Cipher remains the on-site AEO writer).
//  - mint    — Off-site marketing distribution for Tokns.fi (planned).
//  - scribe  — Off-site marketing distribution for Tutorials (PILOT — this
//              is the only marketing agent shipping in the current PR).
//
// This file is import-safe: it has no side effects and no runtime deps so
// it can be loaded in tests, CI, and at boot for assertion.
// ---------------------------------------------------------------------------

export const MARKETING_AGENT_KEYS = ["beacon", "ledger", "mint", "scribe"] as const;
export type AgentKey = (typeof MARKETING_AGENT_KEYS)[number];

export interface SkillOwnership {
  ownerAgentKey: AgentKey;
  readers?: AgentKey[];
}

// Source of truth. Skill keys follow `<surface>.<channel>` convention.
// Adding a row here is the only legitimate way to introduce a new
// marketing skill — the CI test enforces single-owner invariants.
export const MARKETING_SKILLS = {
  // ---- Umbrella feed (Beacon) ----
  "umbrella.blog": { ownerAgentKey: "beacon", readers: ["ledger", "mint", "scribe"] },
  "umbrella.x": { ownerAgentKey: "beacon", readers: ["ledger", "mint", "scribe"] },
  "umbrella.linkedin": { ownerAgentKey: "beacon", readers: ["ledger", "mint", "scribe"] },
  "umbrella.newsletter": { ownerAgentKey: "beacon", readers: ["ledger", "mint", "scribe"] },
  "paid-ads-creative.umbrella": { ownerAgentKey: "beacon" },

  // ---- CreditScore (Ledger — planned) ----
  "creditscore.devto": { ownerAgentKey: "ledger" },
  "creditscore.medium": { ownerAgentKey: "ledger" },
  "creditscore.x": { ownerAgentKey: "ledger" },
  "creditscore.linkedin": { ownerAgentKey: "ledger" },
  "creditscore.youtube": { ownerAgentKey: "ledger" },
  "paid-ads-creative.creditscore": { ownerAgentKey: "ledger" },

  // ---- Tokns (Mint — planned) ----
  "tokns.devto": { ownerAgentKey: "mint" },
  "tokns.medium": { ownerAgentKey: "mint" },
  "tokns.x": { ownerAgentKey: "mint" },
  "tokns.linkedin": { ownerAgentKey: "mint" },
  "tokns.youtube": { ownerAgentKey: "mint" },
  "paid-ads-creative.tokns": { ownerAgentKey: "mint" },

  // ---- Tutorials (Scribe — PILOT) ----
  "tutorials.devto": { ownerAgentKey: "scribe" },
  "tutorials.hashnode": { ownerAgentKey: "scribe" },
  "tutorials.youtube-long": { ownerAgentKey: "scribe" },
  "tutorials.x-clip": { ownerAgentKey: "scribe" },
  "paid-ads-creative.tutorials": { ownerAgentKey: "scribe" },
} as const satisfies Record<string, SkillOwnership>;

export type SkillKey = keyof typeof MARKETING_SKILLS;
export const MARKETING_SKILL_KEYS = Object.keys(MARKETING_SKILLS) as SkillKey[];

/**
 * Returns the list of skill keys whose owner is `agentKey`.
 */
export function skillsOwnedBy(agentKey: AgentKey): SkillKey[] {
  return MARKETING_SKILL_KEYS.filter(
    (k) => MARKETING_SKILLS[k].ownerAgentKey === agentKey,
  );
}

/**
 * Returns the owner agent for a given skill, or null if unknown.
 */
export function ownerOfSkill(skillKey: string): AgentKey | null {
  if (!(skillKey in MARKETING_SKILLS)) return null;
  return MARKETING_SKILLS[skillKey as SkillKey].ownerAgentKey;
}

/**
 * Permission gate: throws if `agentKey` is not the registered owner of
 * `skillKey`. Call at the top of every marketing-agent write path.
 */
export function assertCanWrite(skillKey: string, agentKey: AgentKey): void {
  const owner = ownerOfSkill(skillKey);
  if (owner === null) {
    throw new Error(`marketing-skill-registry: unknown skill '${skillKey}'`);
  }
  if (owner !== agentKey) {
    throw new Error(
      `marketing-skill-registry: agent '${agentKey}' is not the owner of skill '${skillKey}' (owner: '${owner}')`,
    );
  }
}

/**
 * Self-check the registry for invariants. Call at boot AND from CI.
 *  - Every skill has exactly one owner (true by type construction; this is
 *    a runtime assertion in case the constant is mutated by a bad migration).
 *  - Every agent in MARKETING_AGENT_KEYS owns at least one skill.
 */
export function assertSkillRegistryValid(): void {
  const rows = MARKETING_SKILLS as Record<string, SkillOwnership>;
  for (const key of MARKETING_SKILL_KEYS) {
    const row = rows[key];
    if (!row || typeof row !== "object") {
      throw new Error(`marketing-skill-registry: skill '${key}' has no row`);
    }
    if (!MARKETING_AGENT_KEYS.includes(row.ownerAgentKey)) {
      throw new Error(
        `marketing-skill-registry: skill '${key}' has invalid owner '${row.ownerAgentKey}'`,
      );
    }
    if (row.readers) {
      for (const reader of row.readers) {
        if (!MARKETING_AGENT_KEYS.includes(reader)) {
          throw new Error(
            `marketing-skill-registry: skill '${key}' has invalid reader '${reader}'`,
          );
        }
        if (reader === row.ownerAgentKey) {
          throw new Error(
            `marketing-skill-registry: skill '${key}' lists owner as reader`,
          );
        }
      }
    }
  }
  for (const agent of MARKETING_AGENT_KEYS) {
    if (skillsOwnedBy(agent).length === 0) {
      throw new Error(
        `marketing-skill-registry: agent '${agent}' does not own any skill`,
      );
    }
  }
}
