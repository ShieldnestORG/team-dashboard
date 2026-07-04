import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authUsers,
  boardApiKeys,
  cliAuthChallenges,
  companies,
  companyMemberships,
  instanceUserRoles,
} from "@paperclipai/db";
import { conflict, forbidden, notFound } from "../errors.js";

export const BOARD_API_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CLI_AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type CliAuthChallengeStatus = "pending" | "approved" | "cancelled" | "expired";

export function hashBearerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenHashesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createBoardApiToken() {
  return `pcp_board_${randomBytes(24).toString("hex")}`;
}

export function createCliAuthSecret() {
  return `pcp_cli_auth_${randomBytes(24).toString("hex")}`;
}

/**
 * Key expiry at mint time. `ttlMs` defaults to the standard 30-day TTL;
 * the CLI-auth approve flow can override it (capped at 90 days by
 * `approveCliAuthChallengeSchema`) for explicitly long-lived keys such as
 * the external marketing key.
 */
export function boardApiKeyExpiresAt(
  nowMs: number = Date.now(),
  ttlMs: number = BOARD_API_KEY_TTL_MS,
) {
  return new Date(nowMs + ttlMs);
}

export function cliAuthChallengeExpiresAt(nowMs: number = Date.now()) {
  return new Date(nowMs + CLI_AUTH_CHALLENGE_TTL_MS);
}

function challengeStatusForRow(row: typeof cliAuthChallenges.$inferSelect): CliAuthChallengeStatus {
  if (row.cancelledAt) return "cancelled";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  if (row.approvedAt && row.boardApiKeyId) return "approved";
  return "pending";
}

export function boardAuthService(db: Db) {
  async function resolveBoardAccess(userId: string) {
    const [user, memberships, adminRole] = await Promise.all([
      db
        .select({
          id: authUsers.id,
          name: authUsers.name,
          email: authUsers.email,
        })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .then((rows) => rows[0] ?? null),
      db
        .select({
          companyId: companyMemberships.companyId,
          membershipRole: companyMemberships.membershipRole,
        })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
            eq(companyMemberships.status, "active"),
          ),
        ),
      db
        .select({ id: instanceUserRoles.id })
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
        .then((rows) => rows[0] ?? null),
    ]);

    return {
      user,
      companyIds: memberships.map((row) => row.companyId),
      // CONTRACT-4: per-company role alongside the legacy companyIds list.
      // membership_role is free-text in the DB, so role stays string | null.
      memberships: memberships.map((row) => ({
        companyId: row.companyId,
        role: row.membershipRole,
      })),
      isInstanceAdmin: Boolean(adminRole),
    };
  }

  async function resolveBoardActivityCompanyIds(input: {
    userId: string;
    requestedCompanyId?: string | null;
    boardApiKeyId?: string | null;
  }) {
    const access = await resolveBoardAccess(input.userId);
    const companyIds = new Set(access.companyIds);

    if (companyIds.size === 0 && input.requestedCompanyId?.trim()) {
      companyIds.add(input.requestedCompanyId.trim());
    }

    if (companyIds.size === 0 && input.boardApiKeyId?.trim()) {
      const challengeCompanyIds = await db
        .select({ requestedCompanyId: cliAuthChallenges.requestedCompanyId })
        .from(cliAuthChallenges)
        .where(eq(cliAuthChallenges.boardApiKeyId, input.boardApiKeyId.trim()))
        .then((rows) =>
          rows
            .map((row) => row.requestedCompanyId?.trim() ?? null)
            .filter((value): value is string => Boolean(value)),
        );
      for (const companyId of challengeCompanyIds) {
        companyIds.add(companyId);
      }
    }

    if (companyIds.size === 0 && access.isInstanceAdmin) {
      const allCompanyIds = await db
        .select({ id: companies.id })
        .from(companies)
        .then((rows) => rows.map((row) => row.id));
      for (const companyId of allCompanyIds) {
        companyIds.add(companyId);
      }
    }

    return Array.from(companyIds);
  }

  async function findBoardApiKeyByToken(token: string) {
    const tokenHash = hashBearerToken(token);
    const now = new Date();
    return db
      .select()
      .from(boardApiKeys)
      .where(
        and(
          eq(boardApiKeys.keyHash, tokenHash),
          isNull(boardApiKeys.revokedAt),
        ),
      )
      .then((rows) => rows.find((row) => !row.expiresAt || row.expiresAt.getTime() > now.getTime()) ?? null);
  }

  async function touchBoardApiKey(id: string) {
    await db.update(boardApiKeys).set({ lastUsedAt: new Date() }).where(eq(boardApiKeys.id, id));
  }

  async function revokeBoardApiKey(id: string) {
    const now = new Date();
    return db
      .update(boardApiKeys)
      .set({ revokedAt: now, lastUsedAt: now })
      .where(and(eq(boardApiKeys.id, id), isNull(boardApiKeys.revokedAt)))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function createCliAuthChallenge(input: {
    command: string;
    clientName?: string | null;
    requestedAccess: "board" | "instance_admin_required";
    requestedCompanyId?: string | null;
  }) {
    const challengeSecret = createCliAuthSecret();
    const pendingBoardToken = createBoardApiToken();
    const expiresAt = cliAuthChallengeExpiresAt();
    const labelBase = input.clientName?.trim() || "paperclipai cli";
    const pendingKeyName =
      input.requestedAccess === "instance_admin_required"
        ? `${labelBase} (instance admin)`
        : `${labelBase} (board)`;

    const created = await db
      .insert(cliAuthChallenges)
      .values({
        secretHash: hashBearerToken(challengeSecret),
        command: input.command.trim(),
        clientName: input.clientName?.trim() || null,
        requestedAccess: input.requestedAccess,
        requestedCompanyId: input.requestedCompanyId?.trim() || null,
        pendingKeyHash: hashBearerToken(pendingBoardToken),
        pendingKeyName,
        expiresAt,
      })
      .returning()
      .then((rows) => rows[0]);

    return {
      challenge: created,
      challengeSecret,
      pendingBoardToken,
    };
  }

  async function getCliAuthChallenge(id: string) {
    return db
      .select()
      .from(cliAuthChallenges)
      .where(eq(cliAuthChallenges.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getCliAuthChallengeBySecret(id: string, token: string) {
    const challenge = await getCliAuthChallenge(id);
    if (!challenge) return null;
    if (!tokenHashesMatch(challenge.secretHash, hashBearerToken(token))) return null;
    return challenge;
  }

  async function describeCliAuthChallenge(id: string, token: string) {
    const challenge = await getCliAuthChallengeBySecret(id, token);
    if (!challenge) return null;

    const [company, approvedBy] = await Promise.all([
      challenge.requestedCompanyId
        ? db
            .select({ id: companies.id, name: companies.name })
            .from(companies)
            .where(eq(companies.id, challenge.requestedCompanyId))
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      challenge.approvedByUserId
        ? db
            .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
            .from(authUsers)
            .where(eq(authUsers.id, challenge.approvedByUserId))
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

    return {
      id: challenge.id,
      status: challengeStatusForRow(challenge),
      command: challenge.command,
      clientName: challenge.clientName ?? null,
      requestedAccess: challenge.requestedAccess as "board" | "instance_admin_required",
      requestedCompanyId: challenge.requestedCompanyId ?? null,
      requestedCompanyName: company?.name ?? null,
      approvedAt: challenge.approvedAt?.toISOString() ?? null,
      cancelledAt: challenge.cancelledAt?.toISOString() ?? null,
      expiresAt: challenge.expiresAt.toISOString(),
      approvedByUser: approvedBy
        ? {
            id: approvedBy.id,
            name: approvedBy.name,
            email: approvedBy.email,
          }
        : null,
    };
  }

  async function approveCliAuthChallenge(
    id: string,
    token: string,
    userId: string,
    opts: { keyTtlDays?: number | null } = {},
  ) {
    const access = await resolveBoardAccess(userId);
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select ${cliAuthChallenges.id} from ${cliAuthChallenges} where ${cliAuthChallenges.id} = ${id} for update`,
      );

      const challenge = await tx
        .select()
        .from(cliAuthChallenges)
        .where(eq(cliAuthChallenges.id, id))
        .then((rows) => rows[0] ?? null);
      if (!challenge || !tokenHashesMatch(challenge.secretHash, hashBearerToken(token))) {
        throw notFound("CLI auth challenge not found");
      }

      const status = challengeStatusForRow(challenge);
      if (status === "expired") return { status, challenge, keyExpiresAt: null };
      if (status === "cancelled") return { status, challenge, keyExpiresAt: null };

      if (challenge.requestedAccess === "instance_admin_required" && !access.isInstanceAdmin) {
        throw forbidden("Instance admin required");
      }

      // HIGH-1: never let a long-lived key bind to an instance-admin identity.
      // The key inherits the APPROVER's memberships per request, so a 90-day
      // key approved by an admin would be a 90-day admin credential. Long-lived
      // (>30d) mints must come from the key's own non-admin session — that is
      // exactly the runbook's two-step bootstrap (a marketing key approves the
      // 90-day challenge). The 30-day default is unaffected for any approver.
      const defaultTtlDays = Math.round(BOARD_API_KEY_TTL_MS / 86_400_000);
      if (
        opts.keyTtlDays &&
        opts.keyTtlDays > defaultTtlDays &&
        access.isInstanceAdmin
      ) {
        throw forbidden(
          "Long-lived keys must be approved by the key's own (non-admin) session, not an admin — see the runbook two-step flow.",
        );
      }

      let boardKeyId = challenge.boardApiKeyId;
      let keyExpiresAt: Date | null = null;
      if (!boardKeyId) {
        const ttlMs = opts.keyTtlDays
          ? opts.keyTtlDays * 24 * 60 * 60 * 1000
          : BOARD_API_KEY_TTL_MS;
        const createdKey = await tx
          .insert(boardApiKeys)
          .values({
            userId,
            name: challenge.pendingKeyName,
            keyHash: challenge.pendingKeyHash,
            expiresAt: boardApiKeyExpiresAt(Date.now(), ttlMs),
          })
          .returning()
          .then((rows) => rows[0]);
        boardKeyId = createdKey.id;
        keyExpiresAt = createdKey.expiresAt;
      } else {
        // Idempotent re-approve: the key already exists (keyTtlDays cannot
        // retro-extend it) — report its stored expiry.
        keyExpiresAt = await tx
          .select({ expiresAt: boardApiKeys.expiresAt })
          .from(boardApiKeys)
          .where(eq(boardApiKeys.id, boardKeyId))
          .then((rows) => rows[0]?.expiresAt ?? null);
      }

      const approvedAt = challenge.approvedAt ?? new Date();
      const updated = await tx
        .update(cliAuthChallenges)
        .set({
          approvedByUserId: userId,
          boardApiKeyId: boardKeyId,
          approvedAt,
          updatedAt: new Date(),
        })
        .where(eq(cliAuthChallenges.id, challenge.id))
        .returning()
        .then((rows) => rows[0] ?? challenge);

      return { status: "approved" as const, challenge: updated, keyExpiresAt };
    });
  }

  async function cancelCliAuthChallenge(id: string, token: string) {
    const challenge = await getCliAuthChallengeBySecret(id, token);
    if (!challenge) throw notFound("CLI auth challenge not found");

    const status = challengeStatusForRow(challenge);
    if (status === "approved") return { status, challenge };
    if (status === "expired") return { status, challenge };
    if (status === "cancelled") return { status, challenge };

    const updated = await db
      .update(cliAuthChallenges)
      .set({
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cliAuthChallenges.id, challenge.id))
      .returning()
      .then((rows) => rows[0] ?? challenge);

    return { status: "cancelled" as const, challenge: updated };
  }

  /**
   * Admin-only mint of a long-lived board key for an external marketing
   * collaborator (e.g. Eagan). SECURITY INVARIANT — this is the twin of the
   * HIGH-1 guard in `approveCliAuthChallenge`:
   *
   *   The approve path binds the key to the APPROVER, so an admin approving a
   *   90-day key would mint a 90-day ADMIN credential — that path caps admins
   *   at 30 days. THIS path is safe at 90 days ONLY because it binds the key to
   *   a dedicated NON-ADMIN, MARKETING-ONLY identity it finds-or-creates for the
   *   collaborator's email — never to the admin clicking the button. Two guards
   *   keep that true and MUST NOT be relaxed:
   *     (1) if the resolved email is an instance admin, we reject (no 90-day
   *         admin key can ever be minted here); and
   *     (2) after establishing the marketing membership we re-read EVERY active
   *         membership and assert they are all 'marketing' (>=1) — a mixed role
   *         would lift the marketing-role-gate, so we roll back instead.
   *
   * The identity gets no `account` (credential) row, so it can never log in.
   * Idempotent on the identity: re-running with the same email reuses the user
   * + marketing membership and mints an ADDITIONAL key (existing keys keep their
   * own expiry; revoke them explicitly if you are rotating).
   */
  async function createCollaboratorBoardKey(input: {
    name: string;
    email: string;
    ttlDays: number;
    companyId: string;
  }) {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const companyId = input.companyId;
    const ttlMs = input.ttlDays * 24 * 60 * 60 * 1000;

    return db.transaction(async (tx) => {
      const existingUser = await tx
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.email, email))
        .then((rows) => rows[0] ?? null);

      const userId = existingUser?.id ?? randomUUID();
      const reused = Boolean(existingUser);

      if (existingUser) {
        // GUARD (1): the resolved email must NOT be an instance admin, or we
        // would be minting a long-lived admin-scoped credential.
        const adminRole = await tx
          .select({ id: instanceUserRoles.id })
          .from(instanceUserRoles)
          .where(
            and(
              eq(instanceUserRoles.userId, userId),
              eq(instanceUserRoles.role, "instance_admin"),
            ),
          )
          .then((rows) => rows[0] ?? null);
        if (adminRole) {
          throw conflict(
            "That email belongs to an admin; collaborator keys must be non-admin.",
          );
        }

        // Reject BEFORE minting if the existing identity already carries any
        // non-marketing active membership — mixing roles would lift the gate.
        const priorMemberships = await tx
          .select({ membershipRole: companyMemberships.membershipRole })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.principalId, userId),
              eq(companyMemberships.status, "active"),
            ),
          );
        const hasNonMarketing = priorMemberships.some(
          (row) => row.membershipRole !== "marketing",
        );
        if (hasNonMarketing) {
          throw conflict(
            "That email already has non-marketing access; collaborator keys must be marketing-only.",
          );
        }
      } else {
        const now = new Date();
        await tx.insert(authUsers).values({
          id: userId,
          name,
          email,
          emailVerified: true,
          image: null,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Establish the marketing membership (find-or-create, active). The
      // find-or-create is keyed on the (company, principal) unique index, so a
      // re-run stays idempotent instead of duplicating rows.
      const existingMembership = await tx
        .select({
          id: companyMemberships.id,
          membershipRole: companyMemberships.membershipRole,
          status: companyMemberships.status,
        })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existingMembership) {
        await tx.insert(companyMemberships).values({
          companyId,
          principalType: "user",
          principalId: userId,
          status: "active",
          membershipRole: "marketing",
        });
      } else if (
        existingMembership.membershipRole !== "marketing" ||
        existingMembership.status !== "active"
      ) {
        await tx
          .update(companyMemberships)
          .set({ membershipRole: "marketing", status: "active", updatedAt: new Date() })
          .where(eq(companyMemberships.id, existingMembership.id));
      }

      // GUARD (2): re-read EVERY active membership and assert marketing-only.
      const memberships = await tx
        .select({
          companyId: companyMemberships.companyId,
          membershipRole: companyMemberships.membershipRole,
        })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
            eq(companyMemberships.status, "active"),
          ),
        );
      const marketingOnly =
        memberships.length > 0 &&
        memberships.every((row) => row.membershipRole === "marketing");
      if (!marketingOnly) {
        // Rolls back the transaction — never hand out a key on a mixed identity.
        throw conflict(
          "Collaborator identity is not marketing-only; refusing to mint a key.",
        );
      }

      // Mint the board key bound to the marketing-only identity.
      const boardApiToken = createBoardApiToken();
      const createdKey = await tx
        .insert(boardApiKeys)
        .values({
          userId,
          name: `collab: ${email}`,
          keyHash: hashBearerToken(boardApiToken),
          expiresAt: boardApiKeyExpiresAt(Date.now(), ttlMs),
        })
        .returning()
        .then((rows) => rows[0]);

      return {
        boardApiToken,
        keyId: createdKey.id,
        userId,
        email,
        reused,
        expiresAt: createdKey.expiresAt as Date,
        memberships: memberships.map((row) => ({
          companyId: row.companyId,
          role: row.membershipRole,
        })),
      };
    });
  }

  async function assertCurrentBoardKey(keyId: string | undefined, userId: string | undefined) {
    if (!keyId || !userId) throw conflict("Board API key context is required");
    const key = await db
      .select()
      .from(boardApiKeys)
      .where(and(eq(boardApiKeys.id, keyId), eq(boardApiKeys.userId, userId)))
      .then((rows) => rows[0] ?? null);
    if (!key || key.revokedAt) throw notFound("Board API key not found");
    return key;
  }

  return {
    resolveBoardAccess,
    findBoardApiKeyByToken,
    touchBoardApiKey,
    revokeBoardApiKey,
    createCliAuthChallenge,
    getCliAuthChallengeBySecret,
    describeCliAuthChallenge,
    approveCliAuthChallenge,
    cancelCliAuthChallenge,
    assertCurrentBoardKey,
    resolveBoardActivityCompanyIds,
    createCollaboratorBoardKey,
  };
}
