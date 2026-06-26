// ---------------------------------------------------------------------------
// Watchtower CSV export — read-only API surface.
//
// Mounted at /api/watchtower by app.ts (a SEPARATE router from
// routes/watchtower.ts so the two files can be owned independently). One route:
//
//   GET /subscriptions/:id/results.csv → all historical results for the
//                                        subscription, across every run,
//                                        as an RFC-4180 CSV attachment.
//
// Auth mirrors routes/watchtower.ts's `authorizeSubscriptionRead` verbatim:
//   - board actors (admin UI) bypass the ownership check.
//   - an admin-impersonation cookie (`cd_portal_impersonation`) whose target
//     account_id matches the subscription is allowed (read-only by design).
//   - everyone else MUST present a valid `cd_portal_session` cookie AND the
//     subscription must belong to the session's account_id. Anonymous callers
//     get 401, cross-account callers 403, missing subscription 404. This is the
//     same protection as the JSON read routes — a naive unauthenticated
//     /:id/results.csv would leak one customer's competitive intel (engine
//     excerpts) to anyone holding the UUID.
//
// The export scopes to a SUBSCRIPTION (not a single run) so it returns the
// full historical mention log. raw_response is DELIBERATELY excluded — it is
// ~8KB/row of full engine output that would bloat the file and leak more than
// the excerpt the portal already surfaces.
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { Router } from "express";
import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  watchtowerSubscriptions,
  watchtowerRuns,
  watchtowerResults,
} from "@paperclipai/db";
import {
  PORTAL_SESSION_COOKIE,
  customerPortalService,
} from "../services/customer-portal.js";
import {
  ADMIN_IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
} from "../services/admin-impersonation.js";
import { logger } from "../middleware/logger.js";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers["cookie"];
  if (typeof header !== "string") return null;
  for (const raw of header.split(/;\s*/)) {
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const k = raw.slice(0, eq).trim();
    if (k === name) {
      try {
        return decodeURIComponent(raw.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * RFC-4180 CSV cell escaping: wrap a field in double-quotes when it contains a
 * comma, double-quote, or newline, doubling any internal double-quotes. null /
 * undefined become an empty cell. Booleans/numbers are stringified.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function watchtowerExportRoutes(db: Db) {
  const router = Router();
  const portal = customerPortalService(db);

  /**
   * Returns true if the caller may read the subscription. Writes the
   * appropriate error status to `res` and returns false otherwise. Copied from
   * routes/watchtower.ts (the helper there is closure-local, not exported) so
   * this file owns its own auth without importing across route modules.
   */
  function authorizeSubscriptionRead(
    req: Request,
    res: Response,
    subscriptionAccountId: string | null,
  ): boolean {
    if (req.actor?.type === "board") return true;

    const imp = verifyImpersonationCookie(
      readCookie(req, ADMIN_IMPERSONATION_COOKIE),
    );
    if (imp) {
      if (
        !subscriptionAccountId ||
        imp.targetAccountId !== subscriptionAccountId
      ) {
        res.status(403).json({ error: "forbidden" });
        return false;
      }
      return true;
    }

    const session = portal.verifySession(
      readCookie(req, PORTAL_SESSION_COOKIE),
    );
    if (!session) {
      res.status(401).json({ error: "unauthenticated" });
      return false;
    }
    if (
      !subscriptionAccountId ||
      session.accountId !== subscriptionAccountId
    ) {
      res.status(403).json({ error: "forbidden" });
      return false;
    }
    return true;
  }

  // -------------------- GET /subscriptions/:id/results.csv --------------------
  router.get("/subscriptions/:id/results.csv", async (req, res) => {
    const id = req.params.id as string;

    const [sub] = await db
      .select()
      .from(watchtowerSubscriptions)
      .where(eq(watchtowerSubscriptions.id, id));

    if (!sub) return res.status(404).json({ error: "not_found" });
    if (!authorizeSubscriptionRead(req, res, sub.accountId ?? null)) return;

    let rows: Array<{
      runAt: Date;
      runId: string;
      trigger: string;
      prompt: string;
      engine: string;
      mentioned: boolean;
      sentiment: string | null;
      excerpt: string | null;
      latencyMs: number | null;
    }>;
    try {
      // Join results → runs (results carry no timestamp of their own; the run
      // date comes from watchtower_runs.runAt). Newest run first, then engine.
      // No pagination for v1: bounded at ≤50 prompts × 5 engines × ~52 weeks.
      rows = await db
        .select({
          runAt: watchtowerRuns.runAt,
          runId: watchtowerResults.runId,
          trigger: watchtowerRuns.trigger,
          prompt: watchtowerResults.prompt,
          engine: watchtowerResults.engine,
          mentioned: watchtowerResults.mentioned,
          sentiment: watchtowerResults.sentiment,
          excerpt: watchtowerResults.excerpt,
          latencyMs: watchtowerResults.latencyMs,
        })
        .from(watchtowerResults)
        .innerJoin(
          watchtowerRuns,
          eq(watchtowerRuns.id, watchtowerResults.runId),
        )
        .where(eq(watchtowerRuns.subscriptionId, id))
        .orderBy(desc(watchtowerRuns.runAt), asc(watchtowerResults.engine));
    } catch (err) {
      logger.error(
        { err, subscriptionId: id },
        "watchtower: results.csv query failed",
      );
      return res
        .status(500)
        .json({ error: "internal_error", detail: "could not build export" });
    }

    const header =
      "run_at,run_id,trigger,prompt,engine,mentioned,sentiment,excerpt,latency_ms";
    const lines = [header];
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.runAt instanceof Date ? r.runAt.toISOString() : r.runAt),
          csvCell(r.runId),
          csvCell(r.trigger),
          csvCell(r.prompt),
          csvCell(r.engine),
          csvCell(r.mentioned),
          csvCell(r.sentiment),
          csvCell(r.excerpt),
          csvCell(r.latencyMs),
        ].join(","),
      );
    }
    // CRLF line endings per RFC 4180; trailing newline so the file is
    // well-formed for downstream parsers.
    const body = lines.join("\r\n") + "\r\n";

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="watchtower-${id}-${today}.csv"`,
    );
    return res.send(body);
  });

  return router;
}
