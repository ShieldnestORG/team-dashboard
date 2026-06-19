import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import {
  bundlePlans,
  bundleSubscriptions,
  creditscoreSubscriptions,
  customerAccounts,
  customerActionLog,
  customerCredentials,
  customerMagicLinks,
  watchtowerSubscriptions,
  universityMembers,
  universitySubscriptions,
  universityProgress,
  universityNotes,
  CUSTOMER_CREDENTIAL_KINDS,
} from "@paperclipai/db";
import type { CustomerCredentialKind } from "@paperclipai/db";
import {
  asLocalEncryptedMaterial,
  decryptValue,
  encryptValue,
  loadLocalEncryptionKey,
  type LocalEncryptedMaterial,
} from "../secrets/local-encrypted-provider.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Customer Portal MVP service
// ---------------------------------------------------------------------------
// Auth model:
//   1. Customer submits email → magic-link row (15-min TTL) + email send.
//   2. Customer clicks link → server consumes token (single-use), creates
//      `customer_accounts` row if first login, returns accountId.
//   3. Server issues an HMAC-signed cookie (`accountId.expiry.sig`).
//   4. All subsequent requests verify the cookie via `verifySession`.
//
// Credentials are encrypted at rest using the same AES-256-GCM scheme as
// `local-encrypted-provider.ts`. We store the JSON envelope as text; we never
// expose plaintext through any API surface.
//
// Entitlement resolution joins on `email` against the existing per-product
// subscription tables. Multi-tenant workspaces (with company_id linkage) are
// out of scope for V1 — see docs/products/customer-portal.md.
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

function ttlMinutes(): number {
  const raw = process.env.PORTAL_MAGIC_LINK_TTL_MIN;
  const n = raw ? Number(raw) : DEFAULT_TTL_MIN;
  if (!Number.isFinite(n) || n < 1 || n > 60) return DEFAULT_TTL_MIN;
  return Math.floor(n);
}

export function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL?.trim() || "https://app.coherencedaddy.com";
}

function portalApiBaseUrl(): string {
  return (
    process.env.PAPERCLIP_PUBLIC_URL?.trim() || "https://api.coherencedaddy.com"
  );
}

function sessionSecret(): string {
  const s = process.env.PORTAL_SESSION_SECRET?.trim();
  if (!s || s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `PORTAL_SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} chars`,
    );
  }
  return s;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const PORTAL_SESSION_COOKIE = "cd_portal_session";

// ---------------------------------------------------------------------------
// Magic links
// ---------------------------------------------------------------------------

export interface MagicLinkResult {
  token: string;
  expiresAt: Date;
}

export interface ConsumedLink {
  accountId: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Sessions (HMAC-SHA256 signed cookie value)
// ---------------------------------------------------------------------------
// Cookie format: `${accountId}.${expiryMs}.${sigHex}`
//   - accountId is a UUID (no dots).
//   - expiryMs is the absolute UNIX millisecond timestamp at which the cookie
//     stops being valid.
//   - sigHex is HMAC-SHA256 over `${accountId}.${expiryMs}`.
// We use timingSafeEqual on equal-length buffers to prevent timing oracles.

export interface SessionPayload {
  accountId: string;
}

export function issueSession(accountId: string, now: Date = new Date()): string {
  const secret = sessionSecret();
  const expiry = now.getTime() + SESSION_TTL_MS;
  const base = `${accountId}.${expiry}`;
  const sig = createHmac("sha256", secret).update(base).digest("hex");
  return `${base}.${sig}`;
}

export function verifySession(
  cookie: string | undefined | null,
  now: Date = new Date(),
): SessionPayload | null {
  if (!cookie || typeof cookie !== "string") return null;
  const parts = cookie.split(".");
  if (parts.length !== 3) return null;
  const [accountId, expiryStr, sig] = parts;
  if (!accountId || !expiryStr || !sig) return null;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return null;
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(`${accountId}.${expiryStr}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { accountId };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function isCredentialKind(kind: string): kind is CustomerCredentialKind {
  return (CUSTOMER_CREDENTIAL_KINDS as readonly string[]).includes(kind);
}

function envelopeFromString(stored: string): LocalEncryptedMaterial {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error("Stored credential is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Stored credential envelope is not an object");
  }
  return asLocalEncryptedMaterial(parsed as Record<string, unknown>);
}

export interface CustomerEntitlements {
  creditscore: { tier: string; status: string } | null;
  bundles: Array<{ slug: string | null; status: string; bundlePlanId: string }>;
  watchtower: {
    status: string;
    brandName: string;
    domain: string | null;
    subscriptionId: string;
  } | null;
  university: {
    status: string;
    memberSince: string | null;
    plan: string;
    // Lifetime price-lock flag — true for the first N members (founding cohort).
    founding: boolean;
  } | null;
}

export interface AccountWithEntitlements {
  account: {
    id: string;
    email: string;
    stripeCustomerId: string | null;
    createdAt: Date;
    lastLoginAt: Date | null;
  };
  entitlements: CustomerEntitlements;
}

export function customerPortalService(db: Db) {
  async function logAction(
    accountId: string | null,
    kind: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await db.insert(customerActionLog).values({
        accountId,
        kind,
        payload,
      });
    } catch (err) {
      // Audit failures must never break the user request.
      logger.warn(
        { err, accountId, kind },
        "customer-portal: audit log insert failed",
      );
    }
  }

  async function createMagicLink(emailRaw: string): Promise<MagicLinkResult> {
    const email = normalizeEmail(emailRaw);
    if (!email) throw new Error("email required");
    const token = randomBytes(32).toString("base64url");
    const ttl = ttlMinutes();
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000);

    await db.insert(customerMagicLinks).values({
      token,
      email,
      expiresAt,
    });

    // Point at the backend's token-consumption endpoint, not the SPA. The
    // backend sets the session cookie and 302s to the SPA on success, or to
    // `${portalBaseUrl()}/auth?error=...` on failure.
    const url = `${portalApiBaseUrl()}/api/portal/auth?token=${encodeURIComponent(token)}`;
    // Email delivery lives in coherencedaddy-landing per docs/OWNERSHIP.md.
    // We invoke the existing creditscore-email callback channel — the
    // storefront recognizes the kind and renders the right Resend template.
    // If the callback is not configured (local dev), the service warn-and-
    // continues; the link is still in the DB for manual testing.
    try {
      await sendCreditscoreEmail({
        kind: "portal_magic_link",
        to: email,
        data: {
          actionUrl: url,
          expiresAt: expiresAt.toISOString(),
          ttlMinutes: ttl,
          email,
        },
      });
    } catch (err) {
      logger.error(
        { err, email },
        "customer-portal: magic link email dispatch failed",
      );
    }

    await logAction(null, "magic_link_issued", { email });

    return { token, expiresAt };
  }

  // Read-only check used by the GET interstitial. Returning the state
  // separately from `consumeMagicLink` lets us render a confirm-to-sign-in
  // page without burning the single-use token to email/AV link scanners that
  // auto-fetch URLs in inboxes. The actual consume happens on POST.
  // All non-ok states map to the same caller-visible error to avoid leaking
  // whether a token existed at all.
  async function previewMagicLink(
    tokenRaw: string,
  ): Promise<"ok" | "missing" | "expired" | "consumed"> {
    const token = (tokenRaw ?? "").trim();
    if (!token) return "missing";
    const rows = await db
      .select()
      .from(customerMagicLinks)
      .where(eq(customerMagicLinks.token, token))
      .limit(1);
    const row = rows[0];
    if (!row) return "missing";
    if (row.consumedAt) return "consumed";
    if (row.expiresAt.getTime() <= Date.now()) return "expired";
    return "ok";
  }

  async function consumeMagicLink(tokenRaw: string): Promise<ConsumedLink | null> {
    const token = (tokenRaw ?? "").trim();
    if (!token) return null;
    const now = new Date();

    const rows = await db
      .select()
      .from(customerMagicLinks)
      .where(eq(customerMagicLinks.token, token))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.consumedAt) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;

    // Single-use: mark consumed atomically. If two requests race, only the
    // first one observing `consumed_at IS NULL` wins.
    const claim = await db
      .update(customerMagicLinks)
      .set({ consumedAt: now })
      .where(
        and(
          eq(customerMagicLinks.token, token),
          isNull(customerMagicLinks.consumedAt),
        ),
      )
      .returning();
    if (!claim.length) return null;

    const email = normalizeEmail(row.email);

    // Upsert account — relies on the unique index on email (citext in prod).
    const existing = await db
      .select()
      .from(customerAccounts)
      .where(sql`LOWER(${customerAccounts.email}) = ${email}`)
      .limit(1);
    let account = existing[0];
    if (!account) {
      const inserted = await db
        .insert(customerAccounts)
        .values({ email, lastLoginAt: now })
        .returning();
      account = inserted[0];
    } else {
      await db
        .update(customerAccounts)
        .set({ lastLoginAt: now })
        .where(eq(customerAccounts.id, account.id));
    }

    if (!account) return null;

    await logAction(account.id, "session_started", { email });

    return { accountId: account.id, email };
  }

  async function getAccount(accountId: string) {
    const rows = await db
      .select()
      .from(customerAccounts)
      .where(eq(customerAccounts.id, accountId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getAccountWithEntitlements(
    accountId: string,
  ): Promise<AccountWithEntitlements | null> {
    const account = await getAccount(accountId);
    if (!account) return null;

    const email = normalizeEmail(account.email);

    // CreditScore: highest active subscription matched on email.
    const csRows = await db
      .select({
        tier: creditscoreSubscriptions.tier,
        status: creditscoreSubscriptions.status,
        createdAt: creditscoreSubscriptions.createdAt,
      })
      .from(creditscoreSubscriptions)
      .where(
        and(
          sql`LOWER(${creditscoreSubscriptions.email}) = ${email}`,
          or(
            eq(creditscoreSubscriptions.status, "active"),
            eq(creditscoreSubscriptions.status, "past_due"),
            eq(creditscoreSubscriptions.status, "fulfilled"),
          ),
        ),
      )
      .orderBy(desc(creditscoreSubscriptions.createdAt))
      .limit(5);
    const creditscore = csRows.length
      ? { tier: csRows[0].tier, status: csRows[0].status }
      : null;

    // Bundles: bundle_subscriptions has no `email` column directly — it's keyed
    // by company_id. We therefore join via stripe_customer_id when the account
    // has been linked to one (set by the Stripe webhook flow once a portal
    // user purchases something). Until that link exists, bundles are an empty
    // list; the storefront still gates on creditscore + future per-account
    // SKUs which DO have email columns.
    const bundles: CustomerEntitlements["bundles"] = [];
    if (account.stripeCustomerId) {
      const bundleRows = await db
        .select({
          status: bundleSubscriptions.status,
          bundlePlanId: bundleSubscriptions.bundlePlanId,
          slug: bundlePlans.slug,
        })
        .from(bundleSubscriptions)
        .leftJoin(bundlePlans, eq(bundleSubscriptions.bundlePlanId, bundlePlans.id))
        .where(
          and(
            eq(bundleSubscriptions.stripeCustomerId, account.stripeCustomerId),
            or(
              eq(bundleSubscriptions.status, "active"),
              eq(bundleSubscriptions.status, "past_due"),
            ),
          ),
        );
      for (const row of bundleRows) {
        bundles.push({
          slug: row.slug ?? null,
          status: row.status,
          bundlePlanId: row.bundlePlanId,
        });
      }
    }

    // Watchtower: matched on email first (set at checkout time), then by
    // stripe_customer_id when the customer-account-linker has fired. We
    // surface only the most recent active subscription — multi-brand seats
    // are a future SKU.
    let watchtower: CustomerEntitlements["watchtower"] = null;
    const wtRows = await db
      .select({
        id: watchtowerSubscriptions.id,
        status: watchtowerSubscriptions.status,
        brandName: watchtowerSubscriptions.brandName,
        domain: watchtowerSubscriptions.domain,
        createdAt: watchtowerSubscriptions.createdAt,
      })
      .from(watchtowerSubscriptions)
      .where(
        and(
          or(
            sql`LOWER(${watchtowerSubscriptions.email}) = ${email}`,
            account.stripeCustomerId
              ? eq(
                  watchtowerSubscriptions.stripeCustomerId,
                  account.stripeCustomerId,
                )
              : sql`false`,
          ),
          or(
            eq(watchtowerSubscriptions.status, "active"),
            eq(watchtowerSubscriptions.status, "past_due"),
          ),
        ),
      )
      .orderBy(desc(watchtowerSubscriptions.createdAt))
      .limit(1);
    if (wtRows.length) {
      const row = wtRows[0];
      watchtower = {
        subscriptionId: row.id,
        status: row.status,
        brandName: row.brandName,
        domain: row.domain,
      };
    }

    // University: a member is its OWN entity (university_members), not just an
    // access flag — we detect membership here for the portal but the member
    // stays a real row. Matched on email first (the durable join key set at
    // checkout) then by account_id once the customer-account-linker has fired.
    // Surface only the newest active/past_due membership.
    let university: CustomerEntitlements["university"] = null;
    const uniRows = await db
      .select({
        status: universityMembers.status,
        plan: universityMembers.plan,
        founding: universityMembers.founding,
        joinedAt: universityMembers.joinedAt,
        createdAt: universityMembers.createdAt,
      })
      .from(universityMembers)
      .where(
        and(
          or(
            sql`LOWER(${universityMembers.email}) = ${email}`,
            eq(universityMembers.accountId, account.id),
          ),
          or(
            eq(universityMembers.status, "active"),
            eq(universityMembers.status, "past_due"),
          ),
        ),
      )
      .orderBy(desc(universityMembers.createdAt))
      .limit(1);
    if (uniRows.length) {
      const row = uniRows[0];
      university = {
        status: row.status,
        memberSince: (row.joinedAt ?? row.createdAt)?.toISOString() ?? null,
        plan: row.plan,
        founding: row.founding,
      };
    }

    return {
      account: {
        id: account.id,
        email: account.email,
        stripeCustomerId: account.stripeCustomerId,
        createdAt: account.createdAt,
        lastLoginAt: account.lastLoginAt,
      },
      entitlements: { creditscore, bundles, watchtower, university },
    };
  }

  async function listCredentials(accountId: string) {
    const rows = await db
      .select({
        id: customerCredentials.id,
        kind: customerCredentials.kind,
        createdAt: customerCredentials.createdAt,
        revokedAt: customerCredentials.revokedAt,
      })
      .from(customerCredentials)
      .where(
        and(
          eq(customerCredentials.accountId, accountId),
          isNull(customerCredentials.revokedAt),
        ),
      )
      .orderBy(desc(customerCredentials.createdAt));
    // Never include encryptedValue.
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      createdAt: r.createdAt,
    }));
  }

  async function addCredential(
    accountId: string,
    kindRaw: string,
    plaintext: string,
  ): Promise<{ id: string; kind: CustomerCredentialKind; createdAt: Date }> {
    const kind = String(kindRaw);
    if (!isCredentialKind(kind)) {
      throw new Error(
        `Unsupported credential kind: ${kind}. Allowed: ${CUSTOMER_CREDENTIAL_KINDS.join(", ")}`,
      );
    }
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      throw new Error("Credential value required");
    }
    if (plaintext.length > 16_384) {
      // Soft cap to keep storage sane and surface obvious misuse.
      throw new Error("Credential value too large (>16KB)");
    }

    const masterKey = loadLocalEncryptionKey();
    const envelope = encryptValue(masterKey, plaintext);
    const stored = JSON.stringify(envelope);

    // Soft-revoke any prior active credential of the same kind to keep the
    // partial unique index happy.
    await db
      .update(customerCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(customerCredentials.accountId, accountId),
          eq(customerCredentials.kind, kind),
          isNull(customerCredentials.revokedAt),
        ),
      );

    const inserted = await db
      .insert(customerCredentials)
      .values({
        accountId,
        kind,
        encryptedValue: stored,
      })
      .returning({
        id: customerCredentials.id,
        kind: customerCredentials.kind,
        createdAt: customerCredentials.createdAt,
      });

    const row = inserted[0];
    await logAction(accountId, "credential_added", { kind });
    return { id: row.id, kind: row.kind as CustomerCredentialKind, createdAt: row.createdAt };
  }

  async function getCredential(
    accountId: string,
    kindRaw: string,
  ): Promise<string | null> {
    const kind = String(kindRaw);
    if (!isCredentialKind(kind)) return null;
    const rows = await db
      .select({ encryptedValue: customerCredentials.encryptedValue })
      .from(customerCredentials)
      .where(
        and(
          eq(customerCredentials.accountId, accountId),
          eq(customerCredentials.kind, kind),
          isNull(customerCredentials.revokedAt),
        ),
      )
      .limit(1);
    if (!rows.length) return null;
    const masterKey = loadLocalEncryptionKey();
    return decryptValue(masterKey, envelopeFromString(rows[0].encryptedValue));
  }

  async function revokeCredentialById(
    accountId: string,
    credentialId: string,
  ): Promise<boolean> {
    const updated = await db
      .update(customerCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(customerCredentials.id, credentialId),
          eq(customerCredentials.accountId, accountId),
          isNull(customerCredentials.revokedAt),
        ),
      )
      .returning({ id: customerCredentials.id, kind: customerCredentials.kind });
    if (!updated.length) return false;
    await logAction(accountId, "credential_revoked", {
      credentialId,
      kind: updated[0].kind,
    });
    return true;
  }

  async function revokeCredentialByKind(
    accountId: string,
    kindRaw: string,
  ): Promise<boolean> {
    const kind = String(kindRaw);
    if (!isCredentialKind(kind)) return false;
    const updated = await db
      .update(customerCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(customerCredentials.accountId, accountId),
          eq(customerCredentials.kind, kind),
          isNull(customerCredentials.revokedAt),
        ),
      )
      .returning({ id: customerCredentials.id });
    if (!updated.length) return false;
    await logAction(accountId, "credential_revoked", { kind });
    return true;
  }

  /**
   * Is this account a Coherent Ones University member?
   *
   * University bills on a SEPARATE Stripe account (Starwise Ventures), so the
   * billing-portal route needs to know whether to authenticate with the
   * University key. We match on account_id OR email (the same durable join keys
   * getAccountWithEntitlements uses) and ignore status on purpose: a cancelled
   * or past_due member's stripe_customer_id still lives on Starwise, and they
   * may open the billing portal to reactivate or update a card.
   */
  async function isUniversityAccount(accountId: string): Promise<boolean> {
    const account = await getAccount(accountId);
    if (!account) return false;
    const email = normalizeEmail(account.email);
    const rows = await db
      .select({ id: universityMembers.id })
      .from(universityMembers)
      .where(
        or(
          sql`LOWER(${universityMembers.email}) = ${email}`,
          eq(universityMembers.accountId, account.id),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * The Starwise (University-account) Stripe customer id for an account.
   *
   * University bills on a SEPARATE Stripe account, so its customer id is NOT
   * interchangeable with the shared `customer_accounts.stripe_customer_id`
   * column (which the customer-account-linker overwrites last-writer-wins for
   * CreditScore/Watchtower). The Starwise customer id is written ONLY by the
   * University checkout flow (which authenticates with universityStripeKey()),
   * so reading it from `university_subscriptions` guarantees the id and the key
   * always come from the same Stripe account — the fix for the dual-customer
   * edge in /stripe-portal.
   *
   * Matches on account_id OR email (same durable join keys as
   * isUniversityAccount / getAccountWithEntitlements), ignores status (a
   * past_due/cancelled member still has a Starwise customer they may manage),
   * and returns the most recently created subscription's customer id.
   */
  async function getUniversityStripeCustomerId(
    accountId: string,
  ): Promise<string | null> {
    const account = await getAccount(accountId);
    if (!account) return null;
    const email = normalizeEmail(account.email);
    const rows = await db
      .select({ stripeCustomerId: universitySubscriptions.stripeCustomerId })
      .from(universitySubscriptions)
      .where(
        and(
          or(
            sql`LOWER(${universitySubscriptions.email}) = ${email}`,
            eq(universitySubscriptions.accountId, account.id),
          ),
          sql`${universitySubscriptions.stripeCustomerId} IS NOT NULL`,
        ),
      )
      .orderBy(desc(universitySubscriptions.createdAt))
      .limit(1);
    return rows[0]?.stripeCustomerId ?? null;
  }

  async function setStripeCustomerId(
    accountId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    await db
      .update(customerAccounts)
      .set({ stripeCustomerId })
      .where(eq(customerAccounts.id, accountId));
  }

  // -------------------------------------------------------------------------
  // University rep-log / progress — the "Practice" half of the learning loop.
  // -------------------------------------------------------------------------

  // Default weekly goal (number of rep-days in the current 7-day window). The
  // portal renders weekCount / weekGoal as a ring. Overridable via env.
  function weekGoal(): number {
    const raw = process.env.UNIVERSITY_WEEK_GOAL;
    const n = raw ? Number(raw) : 5;
    if (!Number.isFinite(n) || n < 1 || n > 7) return 5;
    return Math.floor(n);
  }

  // Format a Date as a UTC YYYY-MM-DD day bucket. Postgres `date` columns come
  // back as 'YYYY-MM-DD' strings already; this matches that for the rep_day we
  // write and for the streak comparison below.
  function utcDayString(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  // Add `n` UTC days to a YYYY-MM-DD string, returning a YYYY-MM-DD string.
  function addUtcDays(day: string, n: number): string {
    const ms = Date.parse(`${day}T00:00:00.000Z`);
    return utcDayString(new Date(ms + n * 24 * 60 * 60 * 1000));
  }

  /**
   * Deterministic streak from a set of distinct rep-day strings (YYYY-MM-DD,
   * UTC). The current streak is the run of consecutive days ending at `today`
   * or `yesterday` — a streak is NOT broken until a full day is missed, so a
   * member who repped yesterday but not yet today still holds their streak.
   * Returns 0 if the most recent rep is older than yesterday. Pure function of
   * its inputs (Rule 5 — code-graded, not model-graded).
   */
  function computeStreak(repDays: Iterable<string>, today: string): number {
    const set = new Set(repDays);
    if (set.size === 0) return 0;
    const yesterday = addUtcDays(today, -1);
    // Anchor: today if repped today, else yesterday if repped then, else broken.
    let anchor: string;
    if (set.has(today)) anchor = today;
    else if (set.has(yesterday)) anchor = yesterday;
    else return 0;
    let streak = 0;
    let cursor = anchor;
    while (set.has(cursor)) {
      streak += 1;
      cursor = addUtcDays(cursor, -1);
    }
    return streak;
  }

  // Resolve the durable identity (lowercased email + optional accountId) used
  // to scope a member's reps. Mirrors the email-OR-account_id join keys the
  // rest of University uses.
  async function resolveProgressIdentity(
    accountId: string,
  ): Promise<{ email: string; accountId: string } | null> {
    const account = await getAccount(accountId);
    if (!account) return null;
    return { email: normalizeEmail(account.email), accountId: account.id };
  }

  /**
   * Idempotent upsert of TODAY's rep for this member+lesson. Re-submitting the
   * same lesson the same day updates the existing row (ON CONFLICT on the
   * (email, lesson_slug, rep_day) unique index) rather than logging a duplicate.
   * Returns the recomputed streak + this-week count.
   */
  async function recordRep(
    accountId: string,
    lessonSlugRaw: string,
    opts: { reflection?: string | null; quizScore?: number | null } = {},
    now: Date = new Date(),
  ): Promise<{ currentStreak: number; weekCount: number; weekGoal: number }> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    const lessonSlug = lessonSlugRaw.trim();
    if (!lessonSlug) throw new Error("lessonSlug required");

    const repDay = utcDayString(now);
    const reflection =
      typeof opts.reflection === "string" && opts.reflection.length
        ? opts.reflection
        : null;
    const quizScore =
      typeof opts.quizScore === "number" && Number.isFinite(opts.quizScore)
        ? Math.trunc(opts.quizScore)
        : null;

    await db
      .insert(universityProgress)
      .values({
        accountId: identity.accountId,
        email: identity.email,
        lessonSlug,
        drillDone: true,
        reflection,
        quizScore,
        repDay,
      })
      .onConflictDoUpdate({
        target: [
          universityProgress.email,
          universityProgress.lessonSlug,
          universityProgress.repDay,
        ],
        set: {
          // Backfill the account link if it resolved after the first rep, and
          // let a same-day re-submit refresh the reflection / quiz score.
          accountId: identity.accountId,
          reflection,
          quizScore,
          drillDone: true,
        },
      });

    return getProgressSummary(accountId, now);
  }

  /**
   * The member's progress summary: current streak, this-week rep count, the
   * weekly goal, and a recent rep list. Streak is computed in code from the
   * distinct rep-days (Rule 5).
   */
  async function getProgressSummary(
    accountId: string,
    now: Date = new Date(),
  ): Promise<{
    currentStreak: number;
    weekCount: number;
    weekGoal: number;
    recent: Array<{
      lessonSlug: string;
      createdAt: Date;
      reflection: string | null;
    }>;
  }> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) {
      return { currentStreak: 0, weekCount: 0, weekGoal: weekGoal(), recent: [] };
    }

    const rows = await db
      .select({
        lessonSlug: universityProgress.lessonSlug,
        reflection: universityProgress.reflection,
        repDay: universityProgress.repDay,
        createdAt: universityProgress.createdAt,
      })
      .from(universityProgress)
      .where(
        or(
          sql`LOWER(${universityProgress.email}) = ${identity.email}`,
          eq(universityProgress.accountId, identity.accountId),
        ),
      )
      .orderBy(desc(universityProgress.createdAt));

    const today = utcDayString(now);
    // rep_day comes back from the `date` column as a 'YYYY-MM-DD' string.
    const repDays = rows.map((r) => String(r.repDay));
    const currentStreak = computeStreak(repDays, today);

    // This-week count: distinct rep-days within the trailing 7-day window
    // (today and the 6 prior UTC days, inclusive).
    const windowStart = addUtcDays(today, -6);
    const weekDays = new Set(
      repDays.filter((d) => d >= windowStart && d <= today),
    );
    const weekCount = weekDays.size;

    const recent = rows.slice(0, 10).map((r) => ({
      lessonSlug: r.lessonSlug,
      createdAt: r.createdAt,
      reflection: r.reflection,
    }));

    return { currentStreak, weekCount, weekGoal: weekGoal(), recent };
  }

  // -------------------------------------------------------------------------
  // University member NOTES — persisted in-lesson "write this down" prompts.
  //
  // FUTURE: these member notes are the input corpus for a planned "smart
  // pattern recognition" feature ported from the Optimize Me / architect app —
  // it will analyze members' notes to surface what to work on + best
  // suggestions. Not built yet.
  // -------------------------------------------------------------------------

  /**
   * Idempotent upsert of a member's note for a lesson + note slot. Re-saving
   * the same (lesson, note_key) updates the existing row (ON CONFLICT on the
   * (email, lesson_slug, note_key) unique index) and bumps updated_at, rather
   * than appending a duplicate. Returns the saved note.
   */
  async function upsertNote(args: {
    accountId: string;
    lessonSlug: string;
    noteKey: string;
    body: string;
  }): Promise<{
    lessonSlug: string;
    noteKey: string;
    body: string;
    updatedAt: Date;
  }> {
    const identity = await resolveProgressIdentity(args.accountId);
    if (!identity) throw new Error("Account not found");
    const lessonSlug = args.lessonSlug.trim();
    if (!lessonSlug) throw new Error("lessonSlug required");
    const noteKey = args.noteKey.trim();
    if (!noteKey) throw new Error("noteKey required");
    const body = args.body;

    const now = new Date();
    const [row] = await db
      .insert(universityNotes)
      .values({
        accountId: identity.accountId,
        email: identity.email,
        lessonSlug,
        noteKey,
        body,
      })
      .onConflictDoUpdate({
        target: [
          universityNotes.email,
          universityNotes.lessonSlug,
          universityNotes.noteKey,
        ],
        set: {
          // Backfill the account link if it resolved after the first save, and
          // refresh the body + updated_at on a re-save.
          accountId: identity.accountId,
          body,
          updatedAt: now,
        },
      })
      .returning({
        lessonSlug: universityNotes.lessonSlug,
        noteKey: universityNotes.noteKey,
        body: universityNotes.body,
        updatedAt: universityNotes.updatedAt,
      });
    return row;
  }

  /**
   * The member's notes, newest first. Optionally filtered to a single lesson.
   * Scoped to the durable identity (email OR account_id), same as the rep-log.
   */
  async function getNotes(args: {
    accountId: string;
    lessonSlug?: string;
  }): Promise<
    Array<{
      lessonSlug: string;
      noteKey: string;
      body: string;
      updatedAt: Date;
    }>
  > {
    const identity = await resolveProgressIdentity(args.accountId);
    if (!identity) return [];

    const lessonSlug =
      typeof args.lessonSlug === "string" ? args.lessonSlug.trim() : "";
    const identityWhere = or(
      sql`LOWER(${universityNotes.email}) = ${identity.email}`,
      eq(universityNotes.accountId, identity.accountId),
    );
    const where = lessonSlug
      ? and(identityWhere, eq(universityNotes.lessonSlug, lessonSlug))
      : identityWhere;

    return db
      .select({
        lessonSlug: universityNotes.lessonSlug,
        noteKey: universityNotes.noteKey,
        body: universityNotes.body,
        updatedAt: universityNotes.updatedAt,
      })
      .from(universityNotes)
      .where(where)
      .orderBy(desc(universityNotes.updatedAt));
  }

  /**
   * Remove a member's note for a lesson + note slot. Scoped to the durable
   * identity so a member can only delete their own notes.
   */
  async function deleteNote(args: {
    accountId: string;
    lessonSlug: string;
    noteKey: string;
  }): Promise<void> {
    const identity = await resolveProgressIdentity(args.accountId);
    if (!identity) throw new Error("Account not found");
    const lessonSlug = args.lessonSlug.trim();
    const noteKey = args.noteKey.trim();
    if (!lessonSlug) throw new Error("lessonSlug required");
    if (!noteKey) throw new Error("noteKey required");

    await db
      .delete(universityNotes)
      .where(
        and(
          or(
            sql`LOWER(${universityNotes.email}) = ${identity.email}`,
            eq(universityNotes.accountId, identity.accountId),
          ),
          eq(universityNotes.lessonSlug, lessonSlug),
          eq(universityNotes.noteKey, noteKey),
        ),
      );
  }

  return {
    createMagicLink,
    previewMagicLink,
    consumeMagicLink,
    issueSession,
    verifySession,
    getAccount,
    getAccountWithEntitlements,
    addCredential,
    getCredential,
    listCredentials,
    revokeCredentialById,
    revokeCredentialByKind,
    isUniversityAccount,
    getUniversityStripeCustomerId,
    setStripeCustomerId,
    recordRep,
    getProgressSummary,
    computeStreak,
    upsertNote,
    getNotes,
    deleteNote,
    logAction,
  };
}

export type CustomerPortalService = ReturnType<typeof customerPortalService>;
