import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

export interface NitterInstance {
  url: string;
  addedAt: string;
  lastCheckedAt: string | null;
  alive: boolean | null;       // null = never checked
  consecutiveFailures: number;
}

const DEFAULT_INSTANCES: NitterInstance[] = [
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.1d4.us",
  "https://nitter.tiekoetter.com",
  "https://nitter.nl",
].map((url) => ({ url, addedAt: new Date().toISOString(), lastCheckedAt: null, alive: null, consecutiveFailures: 0 }));

export function nitterHealthService(db: Db) {
  async function getInstances(): Promise<NitterInstance[]> {
    try {
      const rows = await db.execute<{ general: Record<string, unknown> }>(sql`
        SELECT general FROM instance_settings WHERE singleton_key = 'default' LIMIT 1
      `);
      const row = Array.isArray(rows) ? rows[0] : (rows as unknown as { rows: typeof rows }).rows?.[0];
      const instances = (row?.general as Record<string, unknown> | undefined)?.nitterInstances;
      if (Array.isArray(instances) && instances.length > 0) return instances as NitterInstance[];
    } catch (err) {
      logger.warn({ err }, "nitter-health: failed to read instances from DB, using defaults");
    }
    return DEFAULT_INSTANCES;
  }

  async function saveInstances(instances: NitterInstance[]): Promise<void> {
    const payload = JSON.stringify({ nitterInstances: instances });
    await db.execute(sql`
      INSERT INTO instance_settings (singleton_key, general, experimental)
      VALUES ('default', ${payload}::jsonb, '{}'::jsonb)
      ON CONFLICT (singleton_key) DO UPDATE
      SET general = instance_settings.general || ${payload}::jsonb,
          updated_at = NOW()
    `);
  }

  async function addInstance(url: string): Promise<NitterInstance> {
    const instances = await getInstances();
    if (instances.some((i) => i.url === url)) throw new Error(`Already configured: ${url}`);
    const entry: NitterInstance = { url, addedAt: new Date().toISOString(), lastCheckedAt: null, alive: null, consecutiveFailures: 0 };
    await saveInstances([...instances, entry]);
    return entry;
  }

  async function removeInstance(url: string): Promise<void> {
    const instances = await getInstances();
    await saveInstances(instances.filter((i) => i.url !== url));
  }

  async function probeInstance(url: string): Promise<boolean> {
    try {
      const res = await fetch(`${url}/robots.txt`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CoherenceDaddy/1.0)" },
        signal: AbortSignal.timeout(5_000),
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async function runHealthCheck(): Promise<{ checked: number; alive: number; dead: number; instances: NitterInstance[] }> {
    const instances = await getInstances();
    const now = new Date().toISOString();

    const updated = await Promise.all(
      instances.map(async (inst) => {
        const alive = await probeInstance(inst.url);
        return {
          ...inst,
          lastCheckedAt: now,
          alive,
          consecutiveFailures: alive ? 0 : inst.consecutiveFailures + 1,
        };
      }),
    );

    await saveInstances(updated);

    const aliveCount = updated.filter((i) => i.alive).length;
    logger.info(
      { alive: aliveCount, dead: updated.length - aliveCount, instances: updated.map((i) => ({ url: i.url, alive: i.alive, failures: i.consecutiveFailures })) },
      "Nitter health check complete",
    );

    return { checked: updated.length, alive: aliveCount, dead: updated.length - aliveCount, instances: updated };
  }

  // Returns URLs for instances not known-dead (alive=null or alive=true)
  async function getLiveInstanceUrls(): Promise<string[]> {
    const instances = await getInstances();
    return instances.filter((i) => i.alive !== false).map((i) => i.url);
  }

  return { getInstances, addInstance, removeInstance, probeInstance, runHealthCheck, getLiveInstanceUrls };
}
