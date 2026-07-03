-- 0147_voice_snippets.sql
-- Content Hub voice-snippet cache: metadata for ElevenLabs-generated audio
-- lines (Mark's clone + the 4 persona voices). The audio BYTES live in the
-- StorageService/assets pipeline (writable /paperclip volume or s3), NOT in
-- postgres — this table only records the cache identity and the asset pointer.
-- Spec: HANDOFF-marketing-content-hub.md (voice-snippet factory);
-- marketing BUILD-PLAN Wave 2 / D-server.
--
-- NUMBERING NOTE: this is team-dashboard's OWN migration sequence continuing
-- after 0146_account_funnel_gate (0146 was claimed on master by PR #136
-- mid-build; this file was renumbered from 0146). Numeric prefixes shared with the
-- University app's parallel sequence are the established convention here
-- (see the 0119_creditscore_audit_runs / 0119_watchtower_rank pair and the
-- note in 0122_zernio_engagement). The journal tag for this file is
-- 0147_voice_snippets. Do not reuse the gap numbers 0059/0086/0135.
--
-- Cache semantics: cache_key = sha256 of the canonical generation request
-- (voice id + model + settings + output format + NFC-normalized trimmed
-- text). Same line + same voice = same row forever; a text change after a
-- kit re-sync mints a NEW row by design (old audio stays valid for the old
-- text). Writers insert with ON CONFLICT DO NOTHING and re-select, so a
-- concurrent double-generate races safely at the DB level too.
--
-- Style mirrors 0122: plain lowercase identifiers, IF NOT EXISTS on every
-- statement, gen_random_uuid(), timestamptz. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS voice_snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  cache_key TEXT NOT NULL,                     -- sha256 of the canonical request (see header)
  voice_key TEXT NOT NULL,                     -- registry key: 'mark' | 'brianna' | 'mami' | 'remy' | 'solene'
  voice_id TEXT NOT NULL,                      -- ElevenLabs voice id resolved server-side (never client-supplied)
  model_id TEXT NOT NULL,                      -- 'eleven_v3' at time of writing
  settings JSONB NOT NULL DEFAULT '{}'::jsonb, -- voice_settings sent to ElevenLabs
  text TEXT NOT NULL,                          -- NFC-normalized, trimmed spoken line
  asset_id UUID NOT NULL REFERENCES assets(id),-- the mp3 bytes, via StorageService
  duration_sec NUMERIC(8, 2),                  -- estimate: byte_size / 16000 (mp3_44100_128 CBR)
  byte_size INTEGER NOT NULL,
  created_by_user_id TEXT,                     -- better-auth ids are non-uuid text
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The cache identity. ON CONFLICT (cache_key) DO NOTHING targets this.
CREATE UNIQUE INDEX IF NOT EXISTS voice_snippets_cache_key_uq
  ON voice_snippets (cache_key);

CREATE INDEX IF NOT EXISTS voice_snippets_company_created_idx
  ON voice_snippets (company_id, created_at);
