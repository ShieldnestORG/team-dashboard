import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { assets } from "./assets.js";

// Content Hub voice-snippet cache (migration 0146_voice_snippets, team-dashboard's
// own sequence). Metadata only — the mp3 bytes live in the StorageService/assets
// pipeline; asset_id points at them. cache_key is the sha256 of the canonical
// generation request (voice id + model + settings + output format + NFC-normalized
// trimmed text); a text change after a kit re-sync mints a new row by design.
export const voiceSnippets = pgTable(
  "voice_snippets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    cacheKey: text("cache_key").notNull(),
    // Registry key: 'mark' | 'brianna' | 'mami' | 'remy' | 'solene'
    voiceKey: text("voice_key").notNull(),
    // ElevenLabs voice id — resolved server-side, never client-supplied.
    voiceId: text("voice_id").notNull(),
    modelId: text("model_id").notNull(),
    settings: jsonb("settings").$type<Record<string, number>>().notNull().default({}),
    text: text("text").notNull(),
    assetId: uuid("asset_id").notNull().references(() => assets.id),
    // Estimate: byte_size / 16000 (mp3_44100_128 is CBR 16KB/s).
    durationSec: numeric("duration_sec", { precision: 8, scale: 2 }),
    byteSize: integer("byte_size").notNull(),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    cacheKeyUq: uniqueIndex("voice_snippets_cache_key_uq").on(table.cacheKey),
    companyCreatedIdx: index("voice_snippets_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
  }),
);

export type VoiceSnippet = typeof voiceSnippets.$inferSelect;
export type NewVoiceSnippet = typeof voiceSnippets.$inferInsert;
