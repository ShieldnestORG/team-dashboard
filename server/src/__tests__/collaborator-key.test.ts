// ---------------------------------------------------------------------------
// Admin-only collaborator marketing key — POST /api/admin/collaborator-keys
// + boardAuth.createCollaboratorBoardKey + createCollaboratorKeySchema.
//
// Security twin of board-auth-key-ttl.test.ts (HIGH-1): a 90-day key is safe
// here ONLY because it binds to a NON-ADMIN, MARKETING-ONLY identity the
// endpoint finds-or-creates — never to the admin clicking the button. These
// tests pin that invariant:
//   - admin + new email  → mints a 90-day key on a marketing-only identity
//   - admin + admin email → rejected (would be a 90-day admin credential)
//   - existing non-marketing membership → rejected (mixing lifts the gate)
//   - non-admin caller   → 403 (route gate)
//   - re-run same email  → idempotent identity, additional key
//
// The DB is stubbed by table identity + backed by a mutable membership array
// (no Postgres), mirroring the board-auth stub style.
// ---------------------------------------------------------------------------

import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  authUsers,
  boardApiKeys,
  companyMemberships,
  instanceUserRoles,
} from "@paperclipai/db";
import { createCollaboratorKeySchema } from "@paperclipai/shared";
import { boardAuthService } from "../services/board-auth.js";
import { accessRoutes } from "../routes/access.js";
import { errorHandler } from "../middleware/index.js";
import { closeIpv4Servers, ipv4Request } from "./helpers/ipv4-agent.js";

afterEach(closeIpv4Servers);

const COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

type MembershipRow = {
  id: string;
  companyId: string;
  membershipRole: string | null;
  status: string;
};

/**
 * Stateful table-identity stub. `user` seeds the authUsers row (null = the
 * email is unknown), `isAdmin` controls the instanceUserRoles lookup, and
 * `memberships` is a mutable array so inserts are observable across the
 * find-or-create + final assert reads.
 */
function makeStub(opts: {
  user?: { id: string; name: string; email: string } | null;
  isAdmin?: boolean;
  memberships?: MembershipRow[];
}) {
  const users = opts.user ? [{ ...opts.user }] : [];
  const memberships: MembershipRow[] = (opts.memberships ?? []).map((m) => ({ ...m }));
  const captured = {
    userInserts: [] as Record<string, unknown>[],
    keyInserts: [] as Record<string, unknown>[],
    membershipInserts: [] as Record<string, unknown>[],
  };

  function selectRows(table: unknown): unknown[] {
    if (table === authUsers) return users;
    if (table === instanceUserRoles) return opts.isAdmin ? [{ id: "role-1" }] : [];
    if (table === companyMemberships) return memberships;
    return [];
  }

  const select = (_cols?: unknown) => ({
    from: (table: unknown) => ({
      where: (_cond?: unknown) => Promise.resolve(selectRows(table)),
    }),
  });

  const insert = (table: unknown) => ({
    values: (v: Record<string, unknown>) => {
      if (table === authUsers) {
        captured.userInserts.push(v);
        users.push({ id: v.id as string, name: v.name as string, email: v.email as string });
      } else if (table === companyMemberships) {
        captured.membershipInserts.push(v);
        memberships.push({
          id: `m-${memberships.length + 1}`,
          companyId: v.companyId as string,
          membershipRole: (v.membershipRole as string) ?? null,
          status: (v.status as string) ?? "active",
        });
      } else if (table === boardApiKeys) {
        captured.keyInserts.push(v);
      }
      return {
        returning: () => Promise.resolve([{ id: "new-key", ...v }]),
      };
    },
  });

  const update = (_table: unknown) => ({
    set: (patch: Record<string, unknown>) => ({
      where: (_cond?: unknown) => {
        // Apply the marketing/active reactivation to the (single) membership.
        for (const m of memberships) {
          if (patch.membershipRole !== undefined) m.membershipRole = patch.membershipRole as string;
          if (patch.status !== undefined) m.status = patch.status as string;
        }
        return Promise.resolve([]);
      },
    }),
  });

  const db = {
    select,
    insert,
    update,
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ select, insert, update }),
  } as never;

  return { db, captured, memberships };
}

function daysFromNow(d: Date): number {
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}

// ---------------------------------------------------------------------------

describe("createCollaboratorKeySchema", () => {
  it("defaults ttlDays to 90 when omitted", () => {
    const parsed = createCollaboratorKeySchema.parse({
      name: "Eagan",
      email: "eagan@example.com",
    });
    expect(parsed.ttlDays).toBe(90);
  });

  it("caps ttlDays at 90 (rejects 120)", () => {
    expect(() =>
      createCollaboratorKeySchema.parse({
        name: "Eagan",
        email: "eagan@example.com",
        ttlDays: 120,
      }),
    ).toThrow();
  });

  it("rejects ttlDays below 1", () => {
    expect(() =>
      createCollaboratorKeySchema.parse({
        name: "Eagan",
        email: "eagan@example.com",
        ttlDays: 0,
      }),
    ).toThrow();
  });

  it("requires a valid email", () => {
    expect(() =>
      createCollaboratorKeySchema.parse({ name: "Eagan", email: "not-an-email" }),
    ).toThrow();
  });
});

describe("boardAuth.createCollaboratorBoardKey", () => {
  it("mints a 90-day key on a NEW marketing-only identity", async () => {
    const { db, captured } = makeStub({ user: null, isAdmin: false, memberships: [] });
    const svc = boardAuthService(db);
    const result = await svc.createCollaboratorBoardKey({
      name: "Eagan",
      email: "Eagan@Example.com",
      ttlDays: 90,
      companyId: COMPANY_ID,
    });

    // Raw token shown once, board-key shaped.
    expect(result.boardApiToken).toMatch(/^pcp_board_/);
    expect(daysFromNow(result.expiresAt)).toBe(90);
    expect(result.reused).toBe(false);
    // Identity created (no prior user), email normalized to lowercase.
    expect(captured.userInserts).toHaveLength(1);
    expect(captured.userInserts[0].email).toBe("eagan@example.com");
    expect(captured.userInserts[0].emailVerified).toBe(true);
    // No credential/account row is ever created (only the user row).
    // Marketing-only membership, key named for the collaborator.
    expect(result.memberships.every((m) => m.role === "marketing")).toBe(true);
    expect(result.memberships.length).toBeGreaterThan(0);
    expect(captured.keyInserts[0].name).toBe("collab: eagan@example.com");
  });

  it("REJECTS when the email belongs to an instance admin", async () => {
    const { db } = makeStub({
      user: { id: "admin-1", name: "Admin", email: "admin@example.com" },
      isAdmin: true,
      memberships: [],
    });
    const svc = boardAuthService(db);
    await expect(
      svc.createCollaboratorBoardKey({
        name: "Admin",
        email: "admin@example.com",
        ttlDays: 90,
        companyId: COMPANY_ID,
      }),
    ).rejects.toThrow(/admin/i);
  });

  it("REJECTS an existing identity that already holds a non-marketing membership", async () => {
    const { db, captured } = makeStub({
      user: { id: "u-1", name: "Mixed", email: "mixed@example.com" },
      isAdmin: false,
      memberships: [
        { id: "m-1", companyId: "other-co", membershipRole: "member", status: "active" },
      ],
    });
    const svc = boardAuthService(db);
    await expect(
      svc.createCollaboratorBoardKey({
        name: "Mixed",
        email: "mixed@example.com",
        ttlDays: 90,
        companyId: COMPANY_ID,
      }),
    ).rejects.toThrow(/marketing-only/i);
    // No key minted on a mixed identity.
    expect(captured.keyInserts).toHaveLength(0);
  });

  it("is idempotent on identity: re-run with same marketing email reuses the user and mints an ADDITIONAL key", async () => {
    const { db, captured } = makeStub({
      user: { id: "u-2", name: "Eagan", email: "eagan@example.com" },
      isAdmin: false,
      memberships: [
        { id: "m-1", companyId: COMPANY_ID, membershipRole: "marketing", status: "active" },
      ],
    });
    const svc = boardAuthService(db);
    const result = await svc.createCollaboratorBoardKey({
      name: "Eagan",
      email: "eagan@example.com",
      ttlDays: 90,
      companyId: COMPANY_ID,
    });
    expect(result.reused).toBe(true);
    // Identity NOT duplicated…
    expect(captured.userInserts).toHaveLength(0);
    // …but a fresh key IS minted (additive, not a rotation).
    expect(captured.keyInserts).toHaveLength(1);
    expect(result.boardApiToken).toMatch(/^pcp_board_/);
  });
});

describe("POST /api/admin/collaborator-keys — instance-admin gate", () => {
  function app(actor: Record<string, unknown>, stubDb: never) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = actor;
      next();
    });
    server.use(
      "/api",
      accessRoutes(stubDb, {
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        bindHost: "127.0.0.1",
        allowedHostnames: [],
      }),
    );
    server.use(errorHandler);
    return server;
  }

  const validBody = { name: "Eagan", email: "eagan@example.com" };

  it("rejects a non-admin board caller with 403 (before any mint)", async () => {
    const { db, captured } = makeStub({ user: null, isAdmin: false, memberships: [] });
    const actor = { type: "board", userId: "user-nonadmin", source: "session", isInstanceAdmin: false };
    const res = await (await ipv4Request(app(actor, db)))
      .post("/api/admin/collaborator-keys")
      .send(validBody);
    expect(res.status).toBe(403);
    // The gate fires before the handler body — no identity or key touched.
    expect(captured.userInserts).toHaveLength(0);
    expect(captured.keyInserts).toHaveLength(0);
  });
});
