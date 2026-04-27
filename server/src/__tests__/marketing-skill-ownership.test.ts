import { describe, expect, it } from "vitest";
import {
  MARKETING_AGENT_KEYS,
  MARKETING_SKILLS,
  MARKETING_SKILL_KEYS,
  assertSkillRegistryValid,
  ownerOfSkill,
  skillsOwnedBy,
} from "../services/marketing-skill-registry.js";

describe("marketing skill ownership registry", () => {
  it("self-check passes (every skill has a valid single owner)", () => {
    expect(() => assertSkillRegistryValid()).not.toThrow();
  });

  it("every skill maps to exactly one owner", () => {
    for (const skillKey of MARKETING_SKILL_KEYS) {
      const owner = ownerOfSkill(skillKey);
      expect(owner, `skill ${skillKey} has no owner`).not.toBeNull();
      expect(MARKETING_AGENT_KEYS).toContain(owner!);
    }
    // No duplicates: collecting (skillKey, owner) pairs should equal the
    // skill list length, and each skill should appear exactly once across
    // the union of all agents' owned-skill sets.
    const acrossAgents = MARKETING_AGENT_KEYS.flatMap((a) => skillsOwnedBy(a));
    expect(new Set(acrossAgents).size).toBe(acrossAgents.length);
    expect(acrossAgents.length).toBe(MARKETING_SKILL_KEYS.length);
  });

  it("each agent's declared owned skills only contains skills assigned to it", () => {
    for (const agent of MARKETING_AGENT_KEYS) {
      for (const skill of skillsOwnedBy(agent)) {
        expect(MARKETING_SKILLS[skill].ownerAgentKey).toBe(agent);
      }
    }
  });

  it("every agent in MARKETING_AGENT_KEYS owns at least one skill", () => {
    for (const agent of MARKETING_AGENT_KEYS) {
      expect(skillsOwnedBy(agent).length).toBeGreaterThan(0);
    }
  });
});
