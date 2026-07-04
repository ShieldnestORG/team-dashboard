// ---------------------------------------------------------------------------
// board-auth approveCliAuthChallenge — key TTL binding rules (HIGH-1).
//
// The board key inherits the APPROVER's memberships on every request, so a
// long-lived (>30d) key approved by an instance admin would be a long-lived
// admin credential. The service must reject that: long-lived mints have to
// come from the key's own non-admin session (the runbook two-step bootstrap,
// where a marketing key approves the 90-day challenge). The 30-day default is
// unchanged for every approver.
//
// The DB is stubbed by table identity (no Postgres): resolveBoardAccess's
// three selects + the transaction's challenge lookup / key insert / challenge
// update are all served from in-memory fixtures.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  authUsers,
  boardApiKeys,
  cliAuthChallenges,
  companyMemberships,
  instanceUserRoles,
} from "@paperclipai/db";
import { boardAuthService, hashBearerToken } from "../services/board-auth.js";

const APPROVE_TOKEN = "pcp_cli_auth_secret_abcdefghijklmnop";

function buildChallenge() {
  return {
    id: "challenge-1",
    secretHash: hashBearerToken(APPROVE_TOKEN),
    command: "eagan-claude desktop",
    clientName: "eagan-claude",
    requestedAccess: "board" as const,
    requestedCompanyId: null,
    pendingKeyHash: hashBearerToken("pcp_board_pending"),
    pendingKeyName: "eagan-claude (board)",
    boardApiKeyId: null as string | null,
    approvedByUserId: null as string | null,
    approvedAt: null as Date | null,
    cancelledAt: null as Date | null,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

/** Table-dispatching stub for the exact query shapes approve + resolveBoardAccess use. */
function makeDb({ isAdmin }: { isAdmin: boolean }) {
  const challenge = buildChallenge();
  const captured: { insertedKey?: Record<string, unknown> } = {};

  function selectRows(table: unknown): unknown[] {
    if (table === authUsers) return [{ id: "user-1", name: "Eagan", email: "e@example.com" }];
    if (table === companyMemberships) return [{ companyId: "c1", membershipRole: "marketing" }];
    if (table === instanceUserRoles) return isAdmin ? [{ id: "role-1" }] : [];
    if (table === cliAuthChallenges) return [challenge];
    if (table === boardApiKeys) return [{ expiresAt: challenge.expiresAt }];
    return [];
  }

  const select = (_cols?: unknown) => ({
    from: (table: unknown) => ({
      where: (_cond?: unknown) => Promise.resolve(selectRows(table)),
    }),
  });

  const insert = (table: unknown) => ({
    values: (v: Record<string, unknown>) => ({
      returning: () => {
        if (table === boardApiKeys) captured.insertedKey = v;
        return Promise.resolve([{ id: "new-key", ...v }]);
      },
    }),
  });

  const update = (_table: unknown) => ({
    set: (_v: unknown) => ({
      where: (_cond: unknown) => ({
        returning: () => Promise.resolve([challenge]),
      }),
    }),
  });

  const tx = { execute: async () => {}, select, insert, update };
  const db = {
    select,
    transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as never;

  return { db, captured };
}

function daysFromNow(d: Date): number {
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}

describe("approveCliAuthChallenge — key TTL binding (HIGH-1)", () => {
  it("REJECTS a long-lived (90d) mint when the approver is an instance admin", async () => {
    const { db } = makeDb({ isAdmin: true });
    const svc = boardAuthService(db);
    await expect(
      svc.approveCliAuthChallenge("challenge-1", APPROVE_TOKEN, "user-1", { keyTtlDays: 90 }),
    ).rejects.toThrow(/Long-lived keys must be approved by the key's own/);
  });

  it("ALLOWS a long-lived (90d) mint when the approver is NOT an admin (marketing)", async () => {
    const { db, captured } = makeDb({ isAdmin: false });
    const svc = boardAuthService(db);
    const result = await svc.approveCliAuthChallenge("challenge-1", APPROVE_TOKEN, "user-1", {
      keyTtlDays: 90,
    });
    expect(result.status).toBe("approved");
    expect(daysFromNow(result.keyExpiresAt as Date)).toBe(90);
    expect(daysFromNow(captured.insertedKey?.expiresAt as Date)).toBe(90);
  });

  it("ALLOWS the 30-day default for an ADMIN approver (default path untouched)", async () => {
    const { db, captured } = makeDb({ isAdmin: true });
    const svc = boardAuthService(db);
    const result = await svc.approveCliAuthChallenge("challenge-1", APPROVE_TOKEN, "user-1");
    expect(result.status).toBe("approved");
    expect(daysFromNow(result.keyExpiresAt as Date)).toBe(30);
    expect(daysFromNow(captured.insertedKey?.expiresAt as Date)).toBe(30);
  });

  it("ALLOWS keyTtlDays at the 30-day boundary for an admin approver", async () => {
    const { db } = makeDb({ isAdmin: true });
    const svc = boardAuthService(db);
    const result = await svc.approveCliAuthChallenge("challenge-1", APPROVE_TOKEN, "user-1", {
      keyTtlDays: 30,
    });
    expect(result.status).toBe("approved");
    expect(daysFromNow(result.keyExpiresAt as Date)).toBe(30);
  });
});
