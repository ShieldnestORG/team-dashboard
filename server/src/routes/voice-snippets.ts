import { Router } from "express";
import type { Request } from "express";
import type { Db } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { assertCompanyAccess } from "./authz.js";
import {
  ElevenLabsError,
  MAX_SNIPPET_TEXT_CHARS,
  VOICE_KEYS,
  VOICE_REGISTRY,
  VoiceNotConfiguredError,
  VoiceQuotaExceededError,
  normalizeSnippetText,
  voiceSnippetService,
} from "../services/voice-snippets.js";

// ---------------------------------------------------------------------------
// Content Hub voice snippets (CONTRACT-3).
//
//   POST /api/voice-snippets          { voiceKey, text, kitId?, field? }
//     → { assetId, contentPath, voiceName, durationSec, byteSize, cached }
//   GET  /api/voice-snippets/health   → { ok, missingVoices }
//
// CONTRACT-1: this file exports `voiceSnippetsRouter` ONLY — it does NOT touch
// app.ts. C-server mounts it at /api/voice-snippets:
//   api.use("/voice-snippets", voiceSnippetsRouter(db, opts.storageService));
// (The repo has no module-level db, so this is the factory form every other
// router here uses; the contract's export name is kept.)
//
// Voice ids live in the server-side registry — a client-supplied voice_id is
// never accepted (shared key + board-reachable endpoint = arbitrary billing).
// Generation is click-triggered by design: this is a POST the UI calls on
// click, never on page load.
// ---------------------------------------------------------------------------

/**
 * The authoring auth-user id for attribution, or null. Excludes the
 * local_trusted implicit board principal ("local-board"), which is not a real
 * user row. Mirrors socials.ts.
 */
function actorUserId(req: Request): string | null {
  if (req.actor.type !== "board") return null;
  if (req.actor.source === "local_implicit") return null;
  return req.actor.userId ?? null;
}

export function voiceSnippetsRouter(
  db: Db,
  storageService: StorageService,
  fetchImpl?: typeof fetch,
): Router {
  const router = Router();
  const svc = voiceSnippetService(db, storageService, fetchImpl);

  // Voice snippets are a logged-in dashboard surface — only the authenticated
  // UI calls these endpoints. Require a board actor: rejects unauthenticated
  // requests in authenticated mode; satisfied implicitly by the local_trusted
  // dev principal. Mirrors socials.ts.
  router.use((req, res, next) => {
    if (req.actor.type !== "board") {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    next();
  });

  router.post("/", async (req, res, next) => {
    // Same single-company pattern as socials.ts; read at request time so the
    // test harness (and late env injection) works without import-order games.
    const companyId = process.env.TEAM_DASHBOARD_COMPANY_ID || "";
    if (!companyId) {
      res.status(503).json({
        error: "Voice generation isn't set up on this server yet (no dashboard company is configured). Tell Mark.",
      });
      return;
    }
    assertCompanyAccess(req, companyId);

    const body = req.body ?? {};
    const voiceKey = typeof body.voiceKey === "string" ? body.voiceKey : "";
    if (!VOICE_REGISTRY[voiceKey]) {
      res.status(400).json({
        error: `Unknown voice "${voiceKey || "(none)"}". Pick one of: ${VOICE_KEYS.join(", ")}.`,
      });
      return;
    }
    const text = typeof body.text === "string" ? normalizeSnippetText(body.text) : "";
    if (!text) {
      res.status(400).json({ error: "There's no text to voice. Send the spoken line as `text`." });
      return;
    }
    if (text.length > MAX_SNIPPET_TEXT_CHARS) {
      res.status(400).json({
        error: `That line is too long to voice (${text.length} characters — the limit is ${MAX_SNIPPET_TEXT_CHARS}). Split it into shorter lines.`,
      });
      return;
    }

    try {
      const result = await svc.generate({
        voiceKey,
        text,
        companyId,
        createdByUserId: actorUserId(req),
      });
      res.json({
        assetId: result.snippet.assetId,
        contentPath: `/api/assets/${result.snippet.assetId}/content`,
        voiceName: result.voiceName,
        durationSec: result.snippet.durationSec === null ? null : Number(result.snippet.durationSec),
        byteSize: result.snippet.byteSize,
        cached: result.cached,
      });
    } catch (err) {
      if (err instanceof VoiceNotConfiguredError) {
        res.status(503).json({
          error: "Voice generation isn't set up yet — the server is missing its voice key. Tell Mark.",
        });
        return;
      }
      if (err instanceof VoiceQuotaExceededError) {
        // Cost guard: each new line is a paid call on Mark's ElevenLabs
        // account. Cached lines still play — only NEW generations are capped.
        res.status(429).json({
          error: `You've hit today's limit for new voice lines (${err.limit}). Lines you already generated still play — try again tomorrow, or tell Mark if you need more today.`,
        });
        return;
      }
      if (err instanceof ElevenLabsError) {
        res.status(502).json({
          error: "The voice service couldn't generate this line right now. Try again in a minute.",
        });
        return;
      }
      next(err);
    }
  });

  // Does the configured key's account expose every registry voice? This is the
  // exact check that caught the wrong-account Scribe key. Click-triggered from
  // an admin surface or curl — never auto-polled.
  //
  // Each call is a live ElevenLabs voices-list request (a paid-account API hit)
  // and this endpoint is board-reachable, so cache a successful result for 60s
  // — the same in-process cooldown system-health.ts uses for its route pings.
  // That caps upstream calls at one per minute no matter how often it's hit.
  const HEALTH_CACHE_TTL = 60_000;
  let healthCache: { result: { ok: boolean; missingVoices: string[] }; at: number } | null = null;

  router.get("/health", async (req, res, next) => {
    if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_TTL) {
      res.json(healthCache.result);
      return;
    }
    try {
      const result = await svc.health();
      healthCache = { result, at: Date.now() };
      res.json(result);
    } catch (err) {
      if (err instanceof VoiceNotConfiguredError) {
        res.status(503).json({
          ok: false,
          missingVoices: VOICE_KEYS,
          error: "Voice generation isn't set up yet — the server is missing its voice key. Tell Mark.",
        });
        return;
      }
      if (err instanceof ElevenLabsError) {
        res.status(502).json({
          ok: false,
          missingVoices: [],
          error: "Couldn't reach the voice service to check the voices. Try again in a minute.",
        });
        return;
      }
      next(err);
    }
  });

  return router;
}
