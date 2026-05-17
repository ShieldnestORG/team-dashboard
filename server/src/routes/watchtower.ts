// ---------------------------------------------------------------------------
// Watchtower brand-mention monitor — read-only API surface (v1).
//
// Mounted at /api/watchtower by app.ts. Four routes:
//
//   GET  /subscriptions/:id              → subscription + last 4 runs
//   GET  /runs/:id                       → run row + per-result detail
//   POST /subscriptions/:id/runs/manual  → customer-facing "Run now". Same
//                                          auth as the GETs (board or owning
//                                          portal session); non-board callers
//                                          are rate-limited by
//                                          checkManualRunCaps. Records the
//                                          run with trigger='manual'.
//   POST /runs/:id/trigger-test          → INTERNAL only — runs the
//                                          subscription that owns the run
//                                          id (or, for now, treats :id as
//                                          the subscription id) and
//                                          returns the new runId. Records
//                                          the run with trigger='test'.
//                                          Gated on INTERNAL_API_TOKEN.
//
// Auth on the two GETs:
//   - board actors (admin UI) bypass the ownership check.
//   - everyone else MUST present a valid `cd_portal_session` cookie AND
//     the subscription must belong to the session's account_id. Anonymous
//     callers and cross-account callers both get 401/403. This closes a
//     latent issue (pre-Phase-1) where any UUID gave back the prompts,
//     stripe customer id, and raw engine responses for any subscription.
//
// Write/CRUD endpoints (subscription create/update/cancel) are owned by
// the customer portal — Stripe webhook + portal-auth path lands in
// services/watchtower-stripe-handler.ts. Don't add them here.
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  watchtowerSubscriptions,
  watchtowerRuns,
  watchtowerResults,
  watchtowerPromptVersions,
} from "@paperclipai/db";
import {
  HARD_PROMPT_CEILING,
  checkManualRunCaps,
  runSubscription,
} from "../services/watchtower-monitor.js";
import {
  PORTAL_SESSION_COOKIE,
  customerPortalService,
} from "../services/customer-portal.js";
import {
  ADMIN_IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
} from "../services/admin-impersonation.js";
import { requireNonImpersonating } from "./portal.js";
import { logger } from "../middleware/logger.js";

function parseImpersonationCookie(req: Request): string | null {
  const header = req.headers["cookie"];
  if (typeof header !== "string") return null;
  for (const raw of header.split(/;\s*/)) {
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const k = raw.slice(0, eq).trim();
    if (k === ADMIN_IMPERSONATION_COOKIE) {
      try {
        return decodeURIComponent(raw.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parsePortalCookie(req: Request): string | null {
  const header = req.headers["cookie"];
  if (typeof header !== "string") return null;
  for (const raw of header.split(/;\s*/)) {
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const k = raw.slice(0, eq).trim();
    if (k === PORTAL_SESSION_COOKIE) {
      try {
        return decodeURIComponent(raw.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function watchtowerRoutes(db: Db) {
  const router = Router();
  const portal = customerPortalService(db);

  /**
   * Returns true if the caller is allowed to read the subscription.
   * Writes the appropriate error status to `res` and returns false otherwise.
   * Board actors bypass the ownership check; everyone else must hold a
   * portal session for the same account_id as the subscription.
   */
  function authorizeSubscriptionRead(
    req: Request,
    res: Response,
    subscriptionAccountId: string | null,
  ): boolean {
    if (req.actor?.type === "board") return true;

    // Impersonation cookie: admin viewing as the target customer. Read-only
    // by design — the /runs/:id/trigger-test route below explicitly blocks it.
    const impCookie = parseImpersonationCookie(req);
    const imp = verifyImpersonationCookie(impCookie);
    if (imp) {
      if (!subscriptionAccountId || imp.targetAccountId !== subscriptionAccountId) {
        res.status(403).json({ error: "forbidden" });
        return false;
      }
      return true;
    }

    const cookie = parsePortalCookie(req);
    const session = portal.verifySession(cookie);
    if (!session) {
      res.status(401).json({ error: "unauthenticated" });
      return false;
    }
    if (!subscriptionAccountId || session.accountId !== subscriptionAccountId) {
      res.status(403).json({ error: "forbidden" });
      return false;
    }
    return true;
  }

  function refuseUnderImpersonation(req: Request, res: Response): boolean {
    const impCookie = parseImpersonationCookie(req);
    const imp = verifyImpersonationCookie(impCookie);
    if (imp) {
      res.status(403).json({
        error: "Read-only: writes are disabled while impersonating a customer.",
        impersonating: true,
      });
      return true;
    }
    return false;
  }

  // -------------------- GET /subscriptions/:id --------------------
  router.get("/subscriptions/:id", async (req, res) => {
    const id = req.params.id as string;
    const [sub] = await db
      .select()
      .from(watchtowerSubscriptions)
      .where(eq(watchtowerSubscriptions.id, id));

    if (!sub) return res.status(404).json({ error: "not_found" });
    if (!authorizeSubscriptionRead(req, res, sub.accountId ?? null)) return;

    const recentRuns = await db
      .select({
        id: watchtowerRuns.id,
        runAt: watchtowerRuns.runAt,
        engines: watchtowerRuns.engines,
        totalPrompts: watchtowerRuns.totalPrompts,
        mentionCount: watchtowerRuns.mentionCount,
        summary: watchtowerRuns.summary,
        promptVersionId: watchtowerRuns.promptVersionId,
      })
      .from(watchtowerRuns)
      .where(eq(watchtowerRuns.subscriptionId, id))
      .orderBy(desc(watchtowerRuns.runAt))
      .limit(4);

    // Active (most-recent) prompt version. The portal renders the
    // comparison-reset banner when the latest run's prompt_version_id
    // differs from the previous run's; it also needs the version's
    // createdAt to label the banner ("Prompts changed on <date>").
    const [latestVersion] = await db
      .select({
        id: watchtowerPromptVersions.id,
        createdAt: watchtowerPromptVersions.createdAt,
      })
      .from(watchtowerPromptVersions)
      .where(eq(watchtowerPromptVersions.subscriptionId, id))
      .orderBy(desc(watchtowerPromptVersions.createdAt))
      .limit(1);

    return res.json({
      subscription: sub,
      recentRuns,
      latestVersion: latestVersion ?? null,
    });
  });

  // -------------------- PATCH /subscriptions/:id/prompts --------------------
  // Customer-edit endpoint for the prompt list. On success this both:
  //   (a) inserts a new immutable row in `watchtower_prompt_versions`
  //   (b) overwrites `watchtower_subscriptions.prompts`
  // The subscription's `prompts` column remains the source of truth for
  // the next scheduled run; the version row is the audit/comparison log.
  router.patch("/subscriptions/:id/prompts", async (req, res) => {
    const id = req.params.id as string;
    const [sub] = await db
      .select()
      .from(watchtowerSubscriptions)
      .where(eq(watchtowerSubscriptions.id, id));

    if (!sub) return res.status(404).json({ error: "not_found" });
    if (!authorizeSubscriptionRead(req, res, sub.accountId ?? null)) return;

    const body = req.body as { prompts?: unknown } | undefined;
    const incoming = body?.prompts;

    if (!Array.isArray(incoming)) {
      return res.status(422).json({
        error: "invalid_prompts",
        detail: "prompts must be an array of strings",
      });
    }

    // Validate each entry: non-empty trimmed string, 1-500 chars.
    const cleaned: string[] = [];
    for (const entry of incoming) {
      if (typeof entry !== "string") {
        return res.status(422).json({
          error: "invalid_prompts",
          detail: "every prompt must be a string",
        });
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0) {
        return res.status(422).json({
          error: "invalid_prompts",
          detail: "prompts cannot be empty or whitespace-only",
        });
      }
      if (trimmed.length > 500) {
        return res.status(422).json({
          error: "invalid_prompts",
          detail: "each prompt must be 500 characters or fewer",
        });
      }
      cleaned.push(trimmed);
    }

    // Deduplicate case-sensitively (case-fold dedupe would surprise users
    // who deliberately submit "Stripe" vs "stripe" to test casing).
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const p of cleaned) {
      if (!seen.has(p)) {
        seen.add(p);
        deduped.push(p);
      }
    }

    if (deduped.length === 0) {
      return res.status(422).json({
        error: "invalid_prompts",
        detail: "at least one prompt is required",
      });
    }

    // Plan cap: take the subscription's per-row cap, never above the
    // system-wide hard ceiling. Mirrors the rule in runSubscription.
    const effectiveCap = Math.min(
      Math.max(1, sub.promptCap ?? 25),
      HARD_PROMPT_CEILING,
    );
    if (deduped.length > effectiveCap) {
      return res.status(422).json({
        error: "prompts_over_cap",
        detail: `too many prompts (${deduped.length}); plan cap is ${effectiveCap}`,
      });
    }

    // Actor attribution: board actors get their actor id; portal users
    // get a "portal" type with the session's accountId (we don't have a
    // single canonical actor table for portal users, so we record the
    // accountId as the actor id).
    let actorId: string | null = null;
    let actorType: string;
    let actorLabel: string | null = null;
    if (req.actor?.type === "board") {
      // userId here is a string id (may not be a UUID), so we record it
      // as the label and leave actorId null to satisfy the UUID column.
      actorType = "board";
      actorLabel = req.actor.userId ?? null;
    } else {
      const session = portal.verifySession(parsePortalCookie(req));
      // authorizeSubscriptionRead above already verified session non-null
      // for non-board callers, so the ?. fallback is defensive only.
      actorId = session?.accountId ?? null;
      actorType = "portal";
    }

    // Transaction: insert the new version row and overwrite the
    // subscription's prompts in one shot so a partial failure doesn't
    // leave the two out of sync.
    let versionId: string;
    try {
      versionId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(watchtowerPromptVersions)
          .values({
            subscriptionId: id,
            prompts: deduped,
            createdByActorId: actorId ?? undefined,
            createdByActorType: actorType,
            createdByActorLabel: actorLabel ?? undefined,
          })
          .returning({ id: watchtowerPromptVersions.id });

        if (!row) throw new Error("failed to insert prompt version");

        await tx
          .update(watchtowerSubscriptions)
          .set({ prompts: deduped })
          .where(eq(watchtowerSubscriptions.id, id));

        return row.id;
      });
    } catch (err) {
      logger.error(
        { err, subscriptionId: id },
        "watchtower: prompt edit transaction failed",
      );
      return res
        .status(500)
        .json({ error: "internal_error", detail: "could not save prompts" });
    }

    return res.json({
      ok: true,
      versionId,
      promptCount: deduped.length,
    });
  });

  // -------------------- GET /runs/:id --------------------
  router.get("/runs/:id", async (req, res) => {
    const id = req.params.id as string;
    const [run] = await db
      .select()
      .from(watchtowerRuns)
      .where(eq(watchtowerRuns.id, id));

    if (!run) return res.status(404).json({ error: "not_found" });

    // Look up the owning subscription so we can enforce ownership.
    const [owningSub] = await db
      .select({ accountId: watchtowerSubscriptions.accountId })
      .from(watchtowerSubscriptions)
      .where(eq(watchtowerSubscriptions.id, run.subscriptionId));

    if (!authorizeSubscriptionRead(req, res, owningSub?.accountId ?? null)) return;

    const results = await db
      .select()
      .from(watchtowerResults)
      .where(eq(watchtowerResults.runId, id));

    return res.json({ run, results });
  });

  // -------------------- POST /runs/:id/trigger-test --------------------
  // INTERNAL: dev/QA helper. The :id here is interpreted as a
  // SUBSCRIPTION id (we don't yet have a "re-run a specific past run"
  // feature — the v1 unit of work is "rerun this subscription"). Naming
  // the path /runs/:id/trigger-test mirrors the spec.
  router.post("/runs/:id/trigger-test", async (req, res) => {
    const expected = process.env.INTERNAL_API_TOKEN?.trim();
    const supplied =
      (req.headers["x-internal-token"] as string | undefined)?.trim() ??
      (req.headers["authorization"] as string | undefined)
        ?.replace(/^Bearer\s+/i, "")
        .trim();

    if (!expected) {
      return res.status(503).json({ error: "internal_token_unset" });
    }
    if (!supplied || supplied !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const subscriptionId = req.params.id as string;
    try {
      const result = await runSubscription(db, subscriptionId, {
        trigger: "test",
      });
      return res.json({
        ok: true,
        runId: result.runId,
        mentionCount: result.mentionCount,
        totalPrompts: result.totalPrompts,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: message, subscriptionId },
        "watchtower: trigger-test failed",
      );
      return res.status(500).json({ error: "run_failed", detail: message });
    }
  });

  // -------------------- POST /subscriptions/:id/runs/manual --------------------
  // Customer-facing "Run now" button (audit Phase 2). Auth is the same as the
  // GET endpoints: a board actor, or a portal session owning the subscription.
  //
  // Non-board callers are rate-limited by `checkManualRunCaps` (1/24h + 5/30d
  // per subscription, 50/hr global). Board actors bypass the caps — ops keeps
  // a single "re-run" path here instead of reaching for /trigger-test.
  router.post("/subscriptions/:id/runs/manual", async (req, res) => {
    const id = req.params.id as string;
    const [sub] = await db
      .select()
      .from(watchtowerSubscriptions)
      .where(eq(watchtowerSubscriptions.id, id));

    if (!sub) return res.status(404).json({ error: "not_found" });
    if (!authorizeSubscriptionRead(req, res, sub.accountId ?? null)) return;
    if (!requireNonImpersonating(req, res)) return;

    if (req.actor?.type !== "board") {
      const cap = await checkManualRunCaps(db, id);
      if (!cap.ok) {
        res.setHeader("Retry-After", String(cap.retryAfterSeconds));
        return res.status(429).json({
          error: cap.code,
          detail: cap.detail,
          retryAfterSeconds: cap.retryAfterSeconds,
        });
      }
    }

    try {
      const result = await runSubscription(db, id, { trigger: "manual" });
      return res.json({
        ok: true,
        runId: result.runId,
        mentionCount: result.mentionCount,
        totalPrompts: result.totalPrompts,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: message, subscriptionId: id },
        "watchtower: manual run failed",
      );
      return res.status(500).json({ error: "run_failed", detail: message });
    }
  });

  return router;
}
