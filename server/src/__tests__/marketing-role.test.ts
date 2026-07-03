// ---------------------------------------------------------------------------
// Marketing role — fail-closed path allowlist + invite role threading +
// green-light read model. Mirrors the socials-posts-rbac harness: the DB is
// stubbed per-test (guards short-circuit before real queries; happy paths only
// need tiny chainable echoes), so this runs without Postgres.
//
// NOTE: local_trusted dev mode makes everyone an implicit instance admin, so
// the gate is invisible in default dev — this suite (and the Wave-4
// authenticated-mode run) is where the gating is actually exercised.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { marketingRoleGate } from "../middleware/marketing-role-gate.js";
import { membershipRoleFromInviteDefaults } from "../routes/access.js";
import { accessService } from "../services/access.js";
import { boardAuthService } from "../services/board-auth.js";
import {
  deriveGreenlightRows,
  probeStat,
  socialsRoutes,
} from "../routes/socials.js";
import { errorHandler } from "../middleware/index.js";

const USER_ID = "user_mkt1";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";

const marketingUser = { type: "board", userId: USER_ID, source: "session", isInstanceAdmin: false };
const memberUser = { type: "board", userId: "user_member", source: "session", isInstanceAdmin: false };
const adminUser = { type: "board", userId: "user_admin", source: "session", isInstanceAdmin: true };
const localImplicit = { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: true };
const unauthenticated = { type: "none", source: "none" };

/** DB stub for the gate: the only query is the active-membership role list. */
function gateDb(roleRows: Array<{ membershipRole: string | null }>) {
  return {
    select: () => ({ from: () => ({ where: async () => roleRows }) }),
  } as never;
}

/** App with the gate + a catch-all that proves pass-through. */
function gateApp(actor: Record<string, unknown>, roleRows: Array<{ membershipRole: string | null }>) {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use(marketingRoleGate(gateDb(roleRows)));
  app.use((_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("marketingRoleGate — fail-closed path allowlist", () => {
  const marketingRows = [{ membershipRole: "marketing" }];

  // Every allowlisted prefix, exercised explicitly (extend this list whenever
  // the middleware's ALLOWED table grows):
  //   /api/auth · /api/health · /api/cli-auth · /api/companies (GET, exact)
  //   /api/socials · /api/voice-snippets · /api/assets (GET)
  it.each([
    ["GET", "/api/socials/zernio/greenlight"],
    ["POST", "/api/socials/posts"],
    ["GET", "/api/cli-auth/me"],
    ["GET", "/api/companies"],
    ["GET", "/api/health"],
    ["POST", "/api/auth/sign-out"],
    ["POST", "/api/voice-snippets"],
    ["GET", "/api/voice-snippets/health"],
    ["GET", "/api/assets/abc/content"],
  ])("allows a marketing-only user: %s %s", async (method, path) => {
    const app = gateApp(marketingUser, marketingRows);
    const res = await request(app)[method.toLowerCase() as "get" | "post"](path);
    expect(res.status).toBe(200);
  });

  it.each([
    ["GET", "/api/costs"],
    ["GET", `/api/companies/${COMPANY_ID}/secrets`],
    ["GET", "/api/routines"],
    ["GET", "/api/instance-settings"],
    ["POST", "/api/companies"],
    ["POST", "/api/assets"],
    ["GET", "/API/costs"], // express routing is case-insensitive — the gate must be too
  ])("blocks a marketing-only user with a plain-English 403: %s %s", async (method, path) => {
    const app = gateApp(marketingUser, marketingRows);
    const res = await request(app)[method.toLowerCase() as "get" | "post"](path);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("marketing_role_restricted");
    expect(res.body.error).toMatch(/marketing/i);
  });

  it("does not restrict an instance admin (even with a marketing membership)", async () => {
    const app = gateApp(adminUser, marketingRows);
    expect((await request(app).get("/api/costs")).status).toBe(200);
  });

  it("does not restrict a plain member", async () => {
    const app = gateApp(memberUser, [{ membershipRole: "member" }]);
    expect((await request(app).get("/api/costs")).status).toBe(200);
  });

  it("does not restrict a user with MIXED roles (marketing + member)", async () => {
    const app = gateApp(memberUser, [
      { membershipRole: "marketing" },
      { membershipRole: "member" },
    ]);
    expect((await request(app).get("/api/costs")).status).toBe(200);
  });

  it("does not restrict a user with zero active memberships", async () => {
    const app = gateApp(memberUser, []);
    expect((await request(app).get("/api/costs")).status).toBe(200);
  });

  it("ignores the local_trusted implicit principal and unauthenticated actors", async () => {
    expect((await request(gateApp(localImplicit, marketingRows)).get("/api/costs")).status).toBe(200);
    expect((await request(gateApp(unauthenticated, marketingRows)).get("/api/costs")).status).toBe(200);
  });

  it("never touches non-/api paths (UI shell always loads)", async () => {
    const app = gateApp(marketingUser, marketingRows);
    expect((await request(app).get("/CD/content-hub")).status).toBe(200);
  });
});

describe("invite → approve membership role threading", () => {
  it("resolves membershipRole='marketing' from defaultsPayload.human", () => {
    expect(
      membershipRoleFromInviteDefaults({ human: { membershipRole: "marketing" } }),
    ).toBe("marketing");
  });

  it("falls back to 'member' for missing/unknown/malformed roles", () => {
    expect(membershipRoleFromInviteDefaults(null)).toBe("member");
    expect(membershipRoleFromInviteDefaults({})).toBe("member");
    expect(membershipRoleFromInviteDefaults({ human: {} })).toBe("member");
    expect(membershipRoleFromInviteDefaults({ human: { membershipRole: "root" } })).toBe("member");
    expect(membershipRoleFromInviteDefaults({ human: { membershipRole: 42 } })).toBe("member");
    expect(membershipRoleFromInviteDefaults({ human: "marketing" } as never)).toBe("member");
  });
});

/** Chainable stub for accessService.ensureMembership. */
function membershipDb(existing: Record<string, unknown> | null) {
  const calls: { updates: Record<string, unknown>[]; inserts: Record<string, unknown>[] } = {
    updates: [],
    inserts: [],
  };
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(existing ? [existing] : []) }) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        calls.updates.push(patch);
        return { where: () => ({ returning: () => Promise.resolve([{ ...existing, ...patch }]) }) };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        calls.inserts.push(values);
        return { returning: () => Promise.resolve([{ id: "new", ...values }]) };
      },
    }),
  } as never;
  return { db, calls };
}

describe("ensureMembership — role clobber audit", () => {
  const base = { id: "m1", status: "active" };

  it("a default 'member' re-call PRESERVES an existing 'marketing' role", async () => {
    const { db, calls } = membershipDb({ ...base, membershipRole: "marketing" });
    const row = await accessService(db).ensureMembership(COMPANY_ID, "user", USER_ID, "member", "active");
    expect(row?.membershipRole).toBe("marketing");
    expect(calls.updates).toHaveLength(0); // nothing to change → no write
  });

  it("a default 'member' re-call also preserves 'owner' (companies.ts creator row)", async () => {
    const { db, calls } = membershipDb({ ...base, membershipRole: "owner" });
    const row = await accessService(db).ensureMembership(COMPANY_ID, "user", USER_ID, "member", "active");
    expect(row?.membershipRole).toBe("owner");
    expect(calls.updates).toHaveLength(0);
  });

  it("status changes still apply while the specific role is preserved", async () => {
    const { db, calls } = membershipDb({ id: "m1", status: "suspended", membershipRole: "marketing" });
    const row = await accessService(db).ensureMembership(COMPANY_ID, "user", USER_ID, "member", "active");
    expect(row?.membershipRole).toBe("marketing");
    expect(row?.status).toBe("active");
    expect(calls.updates[0]?.membershipRole).toBe("marketing");
  });

  it("an EXPLICIT non-default role still overwrites (member → marketing)", async () => {
    const { db, calls } = membershipDb({ ...base, membershipRole: "member" });
    const row = await accessService(db).ensureMembership(COMPANY_ID, "user", USER_ID, "marketing", "active");
    expect(row?.membershipRole).toBe("marketing");
    expect(calls.updates).toHaveLength(1);
  });

  it("insert path persists the requested role (invite approve with 'marketing')", async () => {
    const requested = membershipRoleFromInviteDefaults({ human: { membershipRole: "marketing" } });
    const { db, calls } = membershipDb(null);
    const row = await accessService(db).ensureMembership(COMPANY_ID, "user", USER_ID, requested, "active");
    expect(calls.inserts[0]?.membershipRole).toBe("marketing");
    expect(row?.membershipRole).toBe("marketing");
  });
});

describe("resolveBoardAccess — CONTRACT-4 memberships exposure (/cli-auth/me source)", () => {
  it("returns memberships [{companyId, role}] alongside the legacy companyIds", async () => {
    const db = {
      select: (cols: Record<string, unknown>) => ({
        from: () => ({
          where: () => {
            if ("email" in cols) {
              return Promise.resolve([{ id: USER_ID, name: "Eagan", email: "e@x.com" }]);
            }
            if ("membershipRole" in cols) {
              return Promise.resolve([
                { companyId: "cd", membershipRole: "marketing" },
                { companyId: "tok", membershipRole: "marketing" },
              ]);
            }
            return Promise.resolve([]); // not an instance admin
          },
        }),
      }),
    } as never;
    const access = await boardAuthService(db).resolveBoardAccess(USER_ID);
    expect(access.companyIds).toEqual(["cd", "tok"]);
    expect(access.memberships).toEqual([
      { companyId: "cd", role: "marketing" },
      { companyId: "tok", role: "marketing" },
    ]);
    expect(access.isInstanceAdmin).toBe(false);
  });
});

describe("green-light read model (mirror-backed, no live Zernio call)", () => {
  const NOW = new Date("2026-07-02T12:00:00Z");
  const fresh = new Date("2026-07-02T11:30:00Z"); // 30 min old
  const stale = new Date("2026-07-01T12:00:00Z"); // 24h old

  const automation = (over: Partial<Parameters<typeof deriveGreenlightRows>[0]["automations"][number]>) => ({
    zernioAccountId: "z1",
    name: "ROOM",
    keywords: ["ROOM"],
    clickTag: "room",
    isActive: true,
    stats: {} as Record<string, unknown>,
    lastSyncedAt: fresh as Date | string | null,
    ...over,
  });

  it("probeStat probes candidate keys defensively; unknown → null (never zero)", () => {
    expect(probeStat({ triggered: 12 }, ["triggered"])).toBe(12);
    expect(probeStat({ dms_sent: "7" }, ["dmsSent", "dms_sent"])).toBe(7);
    expect(probeStat({ something_else: 3 }, ["triggered"])).toBeNull();
    expect(probeStat(null, ["triggered"])).toBeNull();
    expect(probeStat({ triggered: "n/a" }, ["triggered"])).toBeNull();
  });

  it("green = active + fresh sync + reported stats", () => {
    const [row] = deriveGreenlightRows({
      automations: [automation({ stats: { triggered: 5, dmsSent: 4, linkClicks: 2 } })],
      handlesByZid: new Map([["z1", "coherencedaddy"]]),
      addonGatedZids: new Set(),
      now: NOW,
    });
    expect(row.tone).toBe("green");
    expect(row.accountLabel).toBe("@coherencedaddy");
    expect(row.stats).toEqual({ triggered: 5, dmsSent: 4, linkClicks: 2 });
  });

  it("amber when the mirror is stale, even if active with stats", () => {
    const [row] = deriveGreenlightRows({
      automations: [automation({ lastSyncedAt: stale, stats: { triggered: 5 } })],
      handlesByZid: new Map(),
      addonGatedZids: new Set(),
      now: NOW,
    });
    expect(row.tone).toBe("amber");
  });

  it("amber with null stats when Zernio reports nothing — 'not reported', never zeros", () => {
    const [row] = deriveGreenlightRows({
      automations: [automation({ stats: {} })],
      handlesByZid: new Map(),
      addonGatedZids: new Set(),
      now: NOW,
    });
    expect(row.tone).toBe("amber");
    expect(row.stats).toEqual({ triggered: null, dmsSent: null, linkClicks: null });
  });

  it("addon-gated accounts map to addonMissing:true (amber), never zeros", () => {
    const [row] = deriveGreenlightRows({
      automations: [automation({ stats: { triggered: 9 } })],
      handlesByZid: new Map(),
      addonGatedZids: new Set(["z1"]),
      now: NOW,
    });
    expect(row.addonMissing).toBe(true);
    expect(row.tone).toBe("amber");
  });

  it("red when the automation is inactive; unknown account falls back to the raw id", () => {
    const [row] = deriveGreenlightRows({
      automations: [automation({ isActive: false })],
      handlesByZid: new Map(),
      addonGatedZids: new Set(),
      now: NOW,
    });
    expect(row.tone).toBe("red");
    expect(row.accountLabel).toBe("z1");
  });

  it("emits one row per keyword; falls back to the automation name when keywords are empty", () => {
    const rows = deriveGreenlightRows({
      automations: [
        automation({ keywords: ["CACHÉ", "CACHE"] }),
        automation({ name: "SHIRT", keywords: [] }),
      ],
      handlesByZid: new Map(),
      addonGatedZids: new Set(),
      now: NOW,
    });
    expect(rows.map((row) => row.keyword)).toEqual(["CACHÉ", "CACHE", "SHIRT"]);
  });
});

describe("GET /api/socials/zernio/greenlight — RBAC + composition", () => {
  const storageStub = {} as never;

  function greenlightDb() {
    return {
      // no-args select → automations mirror; cols select → accounts
      select: (cols?: Record<string, unknown>) => ({
        from: () => ({
          orderBy: async () => [
            {
              zernioAccountId: "z1",
              name: "ROOM",
              keywords: ["ROOM"],
              clickTag: "room",
              isActive: true,
              stats: { triggered: 3 },
              lastSyncedAt: new Date(),
            },
          ],
          where: async () =>
            cols
              ? [{ handle: "coherencedaddy", oauthRef: "zernio:z1" }]
              : [],
        }),
      }),
      execute: async () => [
        { metric: "daily-metrics", zernioAccountId: "z1", addonMissing: false, data: {}, fetchedAt: "x" },
      ],
    } as never;
  }

  function socialsApp(actor: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = actor;
      next();
    });
    app.use("/api/socials", socialsRoutes(greenlightDb(), storageStub));
    app.use(errorHandler);
    return app;
  }

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(socialsApp(unauthenticated)).get("/api/socials/zernio/greenlight");
    expect(res.status).toBe(401);
  });

  it("serves a non-admin board member (marketing users read it) from the mirror", async () => {
    const res = await request(socialsApp(memberUser)).get("/api/socials/zernio/greenlight");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("mirror");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({
      keyword: "ROOM",
      accountLabel: "@coherencedaddy",
      tone: "green",
      addonMissing: false,
      stats: { triggered: 3, dmsSent: null, linkClicks: null },
    });
  });
});
