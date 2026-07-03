import type { Db } from "@paperclipai/db";
import { companies, instanceSettings } from "@paperclipai/db";
import {
  instanceGeneralSettingsSchema,
  type InstanceGeneralSettings,
  instanceExperimentalSettingsSchema,
  type InstanceExperimentalSettings,
  type PatchInstanceGeneralSettings,
  type InstanceSettings,
  type PatchInstanceExperimentalSettings,
} from "@paperclipai/shared";
import { eq } from "drizzle-orm";
import { invalidateLlmSettingsCache } from "./llm-client.js";

const DEFAULT_SINGLETON_KEY = "default";

function normalizeGeneralSettings(raw: unknown): InstanceGeneralSettings {
  const parsed = instanceGeneralSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return {
      censorUsernameInLogs: parsed.data.censorUsernameInLogs ?? false,
      contentLlmProvider: parsed.data.contentLlmProvider ?? "ollama",
      // Empty string clears the override back to the provider default.
      contentLlmModel: parsed.data.contentLlmModel?.trim() || undefined,
    };
  }
  return {
    censorUsernameInLogs: false,
    contentLlmProvider: "ollama",
    contentLlmModel: undefined,
  };
}

function normalizeExperimentalSettings(raw: unknown): InstanceExperimentalSettings {
  const parsed = instanceExperimentalSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return {
      enableIsolatedWorkspaces: parsed.data.enableIsolatedWorkspaces ?? false,
      autoRestartDevServerWhenIdle: parsed.data.autoRestartDevServerWhenIdle ?? false,
    };
  }
  return {
    enableIsolatedWorkspaces: false,
    autoRestartDevServerWhenIdle: false,
  };
}

function toInstanceSettings(row: typeof instanceSettings.$inferSelect): InstanceSettings {
  return {
    id: row.id,
    general: normalizeGeneralSettings(row.general),
    experimental: normalizeExperimentalSettings(row.experimental),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function instanceSettingsService(db: Db) {
  async function getOrCreateRow() {
    const existing = await db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, DEFAULT_SINGLETON_KEY))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;

    const now = new Date();
    const [created] = await db
      .insert(instanceSettings)
      .values({
        singletonKey: DEFAULT_SINGLETON_KEY,
        general: {},
        experimental: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [instanceSettings.singletonKey],
        set: {
          updatedAt: now,
        },
      })
      .returning();

    return created;
  }

  return {
    get: async (): Promise<InstanceSettings> => toInstanceSettings(await getOrCreateRow()),

    getGeneral: async (): Promise<InstanceGeneralSettings> => {
      const row = await getOrCreateRow();
      return normalizeGeneralSettings(row.general);
    },

    getExperimental: async (): Promise<InstanceExperimentalSettings> => {
      const row = await getOrCreateRow();
      return normalizeExperimentalSettings(row.experimental);
    },

    updateGeneral: async (patch: PatchInstanceGeneralSettings): Promise<InstanceSettings> => {
      const current = await getOrCreateRow();
      const nextGeneral = normalizeGeneralSettings({
        ...normalizeGeneralSettings(current.general),
        ...patch,
      });
      const now = new Date();
      const [updated] = await db
        .update(instanceSettings)
        .set({
          general: { ...nextGeneral },
          updatedAt: now,
        })
        .where(eq(instanceSettings.id, current.id))
        .returning();
      // The content-LLM provider/model live in general settings and llm-client
      // caches them for SETTINGS_CACHE_TTL_MS — bust that cache now so an admin's
      // flip takes effect on the very next content call, not up to 30s later.
      invalidateLlmSettingsCache();
      return toInstanceSettings(updated ?? current);
    },

    updateExperimental: async (patch: PatchInstanceExperimentalSettings): Promise<InstanceSettings> => {
      const current = await getOrCreateRow();
      const nextExperimental = normalizeExperimentalSettings({
        ...normalizeExperimentalSettings(current.experimental),
        ...patch,
      });
      const now = new Date();
      const [updated] = await db
        .update(instanceSettings)
        .set({
          experimental: { ...nextExperimental },
          updatedAt: now,
        })
        .where(eq(instanceSettings.id, current.id))
        .returning();
      return toInstanceSettings(updated ?? current);
    },

    listCompanyIds: async (): Promise<string[]> =>
      db
        .select({ id: companies.id })
        .from(companies)
        .then((rows) => rows.map((row) => row.id)),
  };
}
