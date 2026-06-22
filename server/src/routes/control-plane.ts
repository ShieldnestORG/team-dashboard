// ---------------------------------------------------------------------------
// Control Plane — read-only v1 admin view of the repo registry.
//
// Mounted at /api/control-plane by app.ts. Every route is board-only.
// Backed by the static REPO_REGISTRY const-module (services/repo-registry.ts)
// — there is NO DB table for the registry.
//
// Routes:
//   GET  /repos            → full registry + counts
//   GET  /repos/:key       → single repo entry (404 if unknown)
//   POST /repos/:key/ping  → liveness probe of a coupled repo's controlBase
//                            (mirrors the system-health api-routes ping;
//                            5s timeout; coupled repos only)
//
// Read-only by design: this surface performs NO git writes in v1. It reaches
// the 4 coupled repos over HTTP via api.coherencedaddy.com; islands are
// inventory-only and cannot be pinged.
// ---------------------------------------------------------------------------
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  REPO_REGISTRY,
  getRepoCounts,
  type RepoEntry,
} from "../services/repo-registry.js";

// Health path probed on a coupled repo's controlBase. Matches the public
// readiness probe served by the API (see api-registry.ts pingUrl for /health).
const CONTROL_PING_PATH = "/api/health/readiness";

// `db` is accepted for signature parity with sibling route factories and the
// app.ts mount convention; the registry is a static const-module today so it
// is unused. (noUnusedParameters is off in this repo's tsconfig.)
export function controlPlaneRoutes(_db: Db) {
  const router = Router();

  // Board-only guard. Mirrors the inline pattern in watchtower-admin.ts /
  // intel-billing.ts. This inline guard is the SOLE admin enforcement (it
  // rejects every non-board actor across all methods, incl. the POST ping).
  // The app-level boardMutationGuard() is an origin/CSRF check only — it lets
  // non-board actors through — so it does NOT provide admin gating here.
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // -------------------- GET /repos --------------------
  router.get("/repos", (_req, res) => {
    res.json({ repos: REPO_REGISTRY, counts: getRepoCounts() });
  });

  // -------------------- GET /repos/:key --------------------
  router.get("/repos/:key", (req, res) => {
    const key = req.params.key as string;
    const repo = REPO_REGISTRY.find((r) => r.key === key);
    if (!repo) {
      res.status(404).json({ error: "Unknown repo" });
      return;
    }
    res.json(repo);
  });

  // -------------------- POST /repos/:key/ping --------------------
  // Probes the coupled repo's controlBase health path. Mirrors the
  // system-health api-routes ping: bounded 5s timeout, never throws, returns
  // ok=false on any failure. Only coupled repos (with a controlBase) are
  // pingable; islands return 400.
  router.post("/repos/:key/ping", async (req, res) => {
    const key = req.params.key as string;
    const repo: RepoEntry | undefined = REPO_REGISTRY.find((r) => r.key === key);
    if (!repo) {
      res.status(404).json({ error: "Unknown repo" });
      return;
    }
    if (!repo.coupled || !repo.controlBase) {
      res.status(400).json({
        error: "Repo is not coupled to the control plane",
        key: repo.key,
      });
      return;
    }

    const controlBase = repo.controlBase;
    const url = `${controlBase.replace(/\/+$/, "")}${CONTROL_PING_PATH}`;
    const start = Date.now();
    try {
      const resp = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      res.json({
        key: repo.key,
        controlBase,
        ok: resp.ok,
        status: resp.status,
        ms: Date.now() - start,
      });
    } catch {
      res.json({
        key: repo.key,
        controlBase,
        ok: false,
        ms: Date.now() - start,
      });
    }
  });

  return router;
}
