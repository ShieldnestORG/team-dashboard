// ---------------------------------------------------------------------------
// portalCsrfGuard — the Origin/Referer allowlist on /api/portal unsafe methods
// (added by the 2026-07-01 backend security audit remediation).
//
// Locks in the intended semantics:
//   - safe methods (GET/HEAD/OPTIONS) always pass, headerless or not
//   - unsafe methods pass with a trusted Origin (portal app or backend origin)
//   - unsafe methods with an untrusted Origin → 403
//   - no Origin → Referer origin is the fallback (trusted passes, untrusted 403)
//   - neither header on an unsafe request → 403 (fail-closed; browsers always
//     send Origin on unsafe requests, so absence means a non-browser caller)
//   - PORTAL_TRUSTED_ORIGINS extends the allowlist
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { portalCsrfGuard } from "../middleware/portal-csrf.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const PORTAL_ORIGIN = "https://portal.test.local";
const API_ORIGIN = "https://api.test.local";
const EVIL_ORIGIN = "https://evil.test.local";

const ENV_KEYS = [
  "PORTAL_BASE_URL",
  "PAPERCLIP_PUBLIC_URL",
  "PORTAL_TRUSTED_ORIGINS",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function makeApp() {
  const app = express();
  app.use(portalCsrfGuard());
  app.all("/x", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

const local = useLocalServer();

describe("portalCsrfGuard", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.PORTAL_BASE_URL = PORTAL_ORIGIN;
    process.env.PAPERCLIP_PUBLIC_URL = API_ORIGIN;
    delete process.env.PORTAL_TRUSTED_ORIGINS;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("lets safe methods through with no headers at all", async () => {
    const app = makeApp();
    expect((await request(local.via(app)).get("/x")).status).toBe(200);
    expect((await request(local.via(app)).head("/x")).status).toBe(200);
    expect((await request(local.via(app)).options("/x")).status).toBe(200);
  });

  it("allows an unsafe request from the portal app origin", async () => {
    const res = await request(local.via(makeApp()))
      .post("/x")
      .set("Origin", PORTAL_ORIGIN);
    expect(res.status).toBe(200);
  });

  it("allows an unsafe request from the backend's own origin (magic-link consume)", async () => {
    const res = await request(local.via(makeApp())).post("/x").set("Origin", API_ORIGIN);
    expect(res.status).toBe(200);
  });

  it("rejects an unsafe request from an untrusted origin", async () => {
    const res = await request(local.via(makeApp())).post("/x").set("Origin", EVIL_ORIGIN);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/trusted origin/i);
  });

  it("falls back to the Referer origin when Origin is absent", async () => {
    const trusted = await request(local.via(makeApp()))
      .post("/x")
      .set("Referer", `${PORTAL_ORIGIN}/some/page`);
    expect(trusted.status).toBe(200);

    const untrusted = await request(local.via(makeApp()))
      .post("/x")
      .set("Referer", `${EVIL_ORIGIN}/attack`);
    expect(untrusted.status).toBe(403);
  });

  it("does NOT let a trusted Referer rescue an untrusted Origin", async () => {
    const res = await request(local.via(makeApp()))
      .post("/x")
      .set("Origin", EVIL_ORIGIN)
      .set("Referer", `${PORTAL_ORIGIN}/page`);
    expect(res.status).toBe(403);
  });

  it("fail-closes when neither Origin nor Referer is present on an unsafe request", async () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const res = await request(local.via(makeApp()))[method]("/x");
      expect(res.status).toBe(403);
    }
  });

  it("honors PORTAL_TRUSTED_ORIGINS as extra allowlist entries", async () => {
    process.env.PORTAL_TRUSTED_ORIGINS = `https://staging.test.local, ${EVIL_ORIGIN}`;
    const res = await request(local.via(makeApp()))
      .post("/x")
      .set("Origin", "https://staging.test.local");
    expect(res.status).toBe(200);
  });

  it("treats an unparseable Origin as untrusted", async () => {
    const res = await request(local.via(makeApp()))
      .post("/x")
      .set("Origin", "not a url");
    expect(res.status).toBe(403);
  });
});
