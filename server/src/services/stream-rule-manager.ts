import { PULSE_QUERIES } from "./social-pulse-client.js";
import type { FilteredStreamClient, StreamRule } from "./filtered-stream-client.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Tag <-> topic mapping
// ---------------------------------------------------------------------------

const TAG_PREFIX = "pulse:";

function topicToTag(topic: string): string {
  return `${TAG_PREFIX}${topic}`;
}

export function getTopicForTag(tag: string): string | null {
  if (!tag.startsWith(TAG_PREFIX)) return null;
  return tag.slice(TAG_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Rule sync — ensures X API stream rules match PULSE_QUERIES
// ---------------------------------------------------------------------------

export async function syncRules(client: FilteredStreamClient): Promise<void> {
  // 1. Get current rules from X API
  const existing: StreamRule[] = await client.getRules();

  // 2. Build desired rules from PULSE_QUERIES
  const desired = PULSE_QUERIES.map((pq) => ({
    value: pq.query,
    tag: topicToTag(pq.topic),
  }));

  // 3. Find stale rules (exist on API but not in desired)
  const desiredTags = new Set(desired.map((d) => d.tag));
  const staleIds = existing
    .filter((rule) => !rule.tag || !desiredTags.has(rule.tag))
    .map((rule) => rule.id);

  // 4. Find missing rules (in desired but not on API)
  const existingTags = new Set(existing.map((r) => r.tag).filter(Boolean));
  const toAdd = desired.filter((d) => !existingTags.has(d.tag));

  // 5. Delete stale, add missing
  if (staleIds.length > 0) {
    logger.info({ staleIds }, "Deleting stale stream rules");
    await client.deleteRules(staleIds);
  }

  if (toAdd.length > 0) {
    logger.info({ rules: toAdd.map((r) => r.tag) }, "Adding missing stream rules");
    await client.addRules(toAdd);
  }

  if (staleIds.length === 0 && toAdd.length === 0) {
    logger.info(
      { ruleCount: existing.length },
      "Stream rules already in sync",
    );
  }
}
