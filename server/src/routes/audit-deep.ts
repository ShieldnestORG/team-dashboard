// ---------------------------------------------------------------------------
// audit-deep route — POST /api/audit/deep
//
// Premium tier of the audit pipeline. Wraps services/audit-deep.runDeepAudit,
// validates the input URL the same way routes/audit.ts does, and returns the
// structured DeepAuditResult.
//
// Gated by AUDIT_DEEP_ENABLED=true — endpoint returns 503 if unset, even if
// the underlying service module loads fine. This keeps the feature off in
// environments where Playwright browsers aren't installed.
// ---------------------------------------------------------------------------
import { Router } from "express";

import { runDeepAudit, auditDeepEnabled } from "../services/audit-deep.js";

// Mirrors validateAuditUrl in routes/audit.ts. Kept local rather than
// exported from audit.ts to avoid cross-route coupling — the basic and deep
// audits are independent surfaces.
const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fd[0-9a-f]{2}:)/i;

function validateDeepAuditUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "URL must be a valid absolute URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must start with http:// or https://" };
  }
  if (PRIVATE_IP_RE.test(parsed.hostname)) {
    return { ok: false, error: "Private/localhost URLs are not allowed" };
  }
  return { ok: true, url: parsed.toString() };
}

export function auditDeepRoutes(): Router {
  const router = Router();

  router.post("/audit/deep", async (req, res) => {
    if (!auditDeepEnabled()) {
      res.status(503).json({ error: "deep audit disabled" });
      return;
    }

    // CLAUDE.md rule: cast req.body.* defensively as string.
    const body = (req.body ?? {}) as { url?: unknown; maxLinks?: unknown };
    const url = typeof body.url === "string" ? (body.url as string) : "";
    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const validation = validateDeepAuditUrl(url);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    let maxLinks: number | undefined;
    if (typeof body.maxLinks === "number" && Number.isFinite(body.maxLinks)) {
      maxLinks = Math.max(0, Math.floor(body.maxLinks));
    }

    try {
      const result = await runDeepAudit(validation.url, { maxLinks });
      // The service returns structured failures (failureReason set) rather
      // than throwing. We treat those as 500 so monitoring sees them, while
      // still returning the (mostly empty) body for the client to introspect.
      if (result.failureReason) {
        res.status(500).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (err) {
      // Defensive — runDeepAudit shouldn't throw, but if it does we still
      // want JSON shape instead of Express's default HTML 500.
      const message = err instanceof Error ? err.message : "deep audit failed";
      res.status(500).json({ error: message });
    }
  });

  return router;
}
