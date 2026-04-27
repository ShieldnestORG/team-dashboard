import {
  MARKETING_AGENT_KEYS,
  skillsOwnedBy,
  type AgentKey,
} from "./marketing-skill-registry.js";

export type NormalizedAgentPermissions = Record<string, unknown> & {
  canCreateAgents: boolean;
  ownedMarketingSkills: string[];
  publishChannels: string[];
  readOnlyChannels: string[];
};

export function defaultPermissionsForRole(role: string): NormalizedAgentPermissions {
  return {
    canCreateAgents: role === "ceo",
    ownedMarketingSkills: [],
    publishChannels: [],
    readOnlyChannels: [],
  };
}

function isMarketingAgentKey(value: string): value is AgentKey {
  return (MARKETING_AGENT_KEYS as readonly string[]).includes(value);
}

/**
 * Seed marketing-skill ownership onto a permissions object based on the
 * agent's `shortname`. Consults the in-code registry as the source of
 * truth. If the shortname is not a known marketing agent, returns the
 * permissions unchanged.
 */
export function seedMarketingSkillsForShortname(
  permissions: NormalizedAgentPermissions,
  shortname: string | null | undefined,
): NormalizedAgentPermissions {
  if (!shortname) return permissions;
  if (!isMarketingAgentKey(shortname)) return permissions;
  const owned = skillsOwnedBy(shortname);
  return {
    ...permissions,
    ownedMarketingSkills: [...owned],
    publishChannels: [...owned],
  };
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
  }
  return out;
}

export function normalizeAgentPermissions(
  permissions: unknown,
  role: string,
): NormalizedAgentPermissions {
  const defaults = defaultPermissionsForRole(role);
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return defaults;
  }

  const record = permissions as Record<string, unknown>;
  return {
    canCreateAgents:
      typeof record.canCreateAgents === "boolean"
        ? record.canCreateAgents
        : defaults.canCreateAgents,
    ownedMarketingSkills: asStringArray(
      record.ownedMarketingSkills,
      defaults.ownedMarketingSkills,
    ),
    publishChannels: asStringArray(record.publishChannels, defaults.publishChannels),
    readOnlyChannels: asStringArray(record.readOnlyChannels, defaults.readOnlyChannels),
  };
}
