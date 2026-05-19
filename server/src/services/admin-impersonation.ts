import { and, eq, isNull, sql } from "drizzle-orm";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import {
  adminImpersonationNonces,
  customerAccounts,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Admin → customer impersonation service.
//
// Two-step handoff:
//   1. Board admin POSTs /api/watchtower-admin/customers/:subId/impersonate.
//      We mint a single-use, 5-minute, DB-tracked nonce and return a portal
//      URL containing the nonce.
//   2. The portal SPA POSTs /api/portal/admin-impersonate with the nonce.
//      We atomically burn the nonce row and issue a 60-minute HMAC-signed
//      cookie (`cd_portal_impersonation`).
//
// The cookie name is DISTINCT from `cd_portal_session` so customer session
// state and impersonation state can't be confused — and so the "Stop
// impersonating" button can clear ONLY the impersonation cookie without
// touching a real customer's session (relevant when an admin tests against
// their own customer account).
//
// Read-only enforcement: req.actor is NOT mutated by the impersonation
// cookie; instead `req.impersonation` carries the impersonation context.
// Non-GET portal routes call `requireNonImpersonating(req, res)` to block
// writes. Today the portal has only read endpoints + an /agents approve/
// reject + /credentials mutation; the helper protects against future
// additions and is asserted by tests.
// ---------------------------------------------------------------------------

const NONCE_TTL_MIN = 5;
const SESSION_TTL_MIN = 60;
const SESSION_TTL_MS = SESSION_TTL_MIN * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

export const ADMIN_IMPERSONATION_COOKIE = "cd_portal_impersonation";

function sessionSecret(): string {
  // We deliberately reuse PORTAL_SESSION_SECRET. A second secret adds an
  // operational footgun (two values to rotate together) without meaningfully
  // improving security — the cookie name + payload schema are enough to
  // distinguish the two token kinds, and forging one cookie from the other
  // requires the secret anyway.
  const s = process.env.PORTAL_SESSION_SECRET?.trim();
  if (!s || s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `PORTAL_SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} chars`,
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Impersonation session cookie format.
//
// `${sid}.${adminActorId}.${targetAccountId}.${startedAtMs}.${expiryMs}.${sig}`
//
// sig = HMAC-SHA256(secret, "impersonation:" + everything-before-sig).
// The literal `impersonation:` domain-separator prevents any chance of a
// `cd_portal_session` HMAC being replayed as an impersonation token under
// the same secret.
// ---------------------------------------------------------------------------

export interface ImpersonationSession {
  sid: string;
  adminActorId: string;
  targetAccountId: string;
  startedAt: Date;
  expiresAt: Date;
}

export function issueImpersonationCookie(input: {
  adminActorId: string;
  targetAccountId: string;
  now?: Date;
}): { value: string; session: ImpersonationSession } {
  const now = input.now ?? new Date();
  const sid = randomUUID();
  const startedAtMs = now.getTime();
  const expiryMs = startedAtMs + SESSION_TTL_MS;
  const base = `${sid}.${input.adminActorId}.${input.targetAccountId}.${startedAtMs}.${expiryMs}`;
  const secret = sessionSecret();
  const sig = createHmac("sha256", secret)
    .update(`impersonation:${base}`)
    .digest("hex");
  return {
    value: `${base}.${sig}`,
    session: {
      sid,
      adminActorId: input.adminActorId,
      targetAccountId: input.targetAccountId,
      startedAt: new Date(startedAtMs),
      expiresAt: new Date(expiryMs),
    },
  };
}

export function verifyImpersonationCookie(
  cookie: string | undefined | null,
  now: Date = new Date(),
): ImpersonationSession | null {
  if (!cookie || typeof cookie !== "string") return null;
  const parts = cookie.split(".");
  if (parts.length !== 6) return null;
  const [sid, adminActorId, targetAccountId, startedAtStr, expiryStr, sig] =
    parts;
  if (!sid || !adminActorId || !targetAccountId || !startedAtStr || !expiryStr || !sig) {
    return null;
  }
  const startedAt = Number(startedAtStr);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiry)) return null;
  if (expiry <= now.getTime()) return null;

  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return null;
  }
  const base = `${sid}.${adminActorId}.${targetAccountId}.${startedAtStr}.${expiryStr}`;
  const expected = createHmac("sha256", secret)
    .update(`impersonation:${base}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return {
    sid,
    adminActorId,
    targetAccountId,
    startedAt: new Date(startedAt),
    expiresAt: new Date(expiry),
  };
}

// ---------------------------------------------------------------------------
// Nonce minting + exchange
// ---------------------------------------------------------------------------

export interface MintNonceInput {
  adminActorId: string;
  adminActorLabel?: string | null;
  targetAccountId: string;
  targetCustomerLabel?: string | null;
  now?: Date;
}

export interface MintedNonce {
  nonce: string;
  expiresAt: Date;
}

export interface ExchangeResult {
  session: ImpersonationSession;
  cookieValue: string;
  targetEmail: string | null;
  adminActorId: string;
}

export function adminImpersonationService(db: Db) {
  async function mintNonce(input: MintNonceInput): Promise<MintedNonce> {
    const now = input.now ?? new Date();
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = new Date(now.getTime() + NONCE_TTL_MIN * 60 * 1000);
    // Drive expires_at via SQL `now() + interval` instead of passing a JS
    // Date as a bound parameter — postgres.js + Neon's pgbouncer pooler
    // throws `TypeError: Received an instance of Date` on Date params in
    // this code path (works fine against direct connections / embedded
    // postgres, which is why tests passed but prod 500'd from 2026-05-09
    // until the 2026-05-19 fix). Returned `expiresAt` stays the JS-side
    // value; small drift from server `now()` is fine (TTL hint only).
    await db.insert(adminImpersonationNonces).values({
      nonce,
      adminActorId: input.adminActorId,
      adminActorLabel: input.adminActorLabel ?? null,
      targetAccountId: input.targetAccountId,
      targetCustomerLabel: input.targetCustomerLabel ?? null,
      expiresAt: sql`now() + (${NONCE_TTL_MIN} * interval '1 minute')`,
    });
    return { nonce, expiresAt };
  }

  async function exchangeNonce(
    nonceRaw: string,
    now: Date = new Date(),
  ): Promise<ExchangeResult | null> {
    const nonce = (nonceRaw ?? "").trim();
    if (!nonce) return null;

    // Atomic single-use: only the row that still has burned_at IS NULL AND
    // expires_at > now wins the UPDATE. Concurrent exchanges race; second
    // returns zero rows → null → caller responds 401.
    // burned_at + the expiry comparison both use SQL `now()` — see mintNonce
    // comment for why JS Date params fail against the Neon pooler. The `now`
    // arg is still threaded through to `issueImpersonationCookie` (which
    // signs a JS-side timestamp into the cookie payload).
    const claim = await db
      .update(adminImpersonationNonces)
      .set({ burnedAt: sql`now()` })
      .where(
        and(
          eq(adminImpersonationNonces.nonce, nonce),
          isNull(adminImpersonationNonces.burnedAt),
          sql`${adminImpersonationNonces.expiresAt} > now()`,
        ),
      )
      .returning();

    if (!claim.length) return null;
    const row = claim[0];

    // Resolve target email for the response (banner label). We tolerate a
    // missing account row — the cookie still works, the banner just shows
    // "unknown" — because the foreign key isn't enforced (target_account_id
    // is a bare uuid, deliberately, so log entries survive cascade deletes).
    let email: string | null = null;
    try {
      const acct = await db
        .select({ email: customerAccounts.email })
        .from(customerAccounts)
        .where(eq(customerAccounts.id, row.targetAccountId))
        .limit(1);
      email = acct[0]?.email ?? row.targetCustomerLabel ?? null;
    } catch (err) {
      logger.warn({ err }, "admin-impersonation: account lookup failed");
      email = row.targetCustomerLabel ?? null;
    }

    const { value: cookieValue, session } = issueImpersonationCookie({
      adminActorId: row.adminActorId,
      targetAccountId: row.targetAccountId,
      now,
    });

    return {
      session,
      cookieValue,
      targetEmail: email,
      adminActorId: row.adminActorId,
    };
  }

  return { mintNonce, exchangeNonce };
}

export type AdminImpersonationService = ReturnType<typeof adminImpersonationService>;
