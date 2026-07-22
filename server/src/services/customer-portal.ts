import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
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
  universityCheckins,
  universityNotes,
  universityCancelFeedback,
  universityCommunityPosts,
  universityCommunityComments,
  universityCommunityReactions,
  universityCommunityIdeaVotes,
  universityCommunityReports,
  universityCommunityNotifications,
  universityTrainingScores,
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
import { voiceBudgetService } from "./voice-budget.js";
import leoProfanity from "leo-profanity";
import { logger } from "../middleware/logger.js";
import { getEmbedding } from "./intel-embeddings.js";
import { scoreNotesByKeyword } from "./university/notes-keyword-fallback.js";

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

export function portalApiBaseUrl(): string {
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
// University community — shared constants, types, and pure helpers.
// ---------------------------------------------------------------------------

// Body length caps (service-enforced). Owner-confirmed defaults (DESIGN §13.9).
const COMMUNITY_POST_MAX = 5000;
const COMMUNITY_COMMENT_MAX = 2000;
const COMMUNITY_REPORT_REASON_MAX = 500;

// Neutral display-name fallback when a member has no display_name. Owner
// decision §13.1 — never expose the email.
const COMMUNITY_NAME_FALLBACK = "Coherent One";

// A typed service error so routes can map an expected business outcome to a
// specific HTTP status (e.g. 422 profanity, 404 missing target, 400 bad body)
// without string-matching. True/unexpected failures still throw plain Error.
export class CommunityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CommunityError";
  }
}

// The owner ("Mark") / staff email list, env-config'd (owner decision §13.3 —
// no schema flag). Comma-separated COMMUNITY_STAFF_EMAILS; lowercased.
function communityStaffEmails(): Set<string> {
  const raw = process.env.COMMUNITY_STAFF_EMAILS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter((e) => e.length > 0),
  );
}

// Deterministic profanity gate (code, not an LLM — CLAUDE.md Rule 5). leo-
// profanity's default English dictionary; conservative by design. `check()`
// returns true if any listed word appears.
function isCommunityProfane(text: string): boolean {
  return leoProfanity.check(text);
}

// A stable, collision-safe @handle derived at read time (no persisted column in
// MVP — owner decision §13.2). Slug from display name (or email local-part),
// lowercased, non-alphanumerics stripped, with a short deterministic suffix
// from the email so two members who slugify the same stay distinct.
export function deriveCommunityHandle(
  email: string,
  displayName: string | null,
): string {
  const source =
    displayName && displayName.trim().length
      ? displayName
      : email.split("@")[0] ?? "member";
  let slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);
  if (!slug) slug = "member";
  // Deterministic 4-char suffix from the email so collisions are disambiguated
  // stably (same member → same handle on every render).
  const suffix = createHmac("sha256", "community-handle")
    .update(normalizeEmail(email))
    .digest("hex")
    .slice(0, 4);
  return `${slug}${suffix}`;
}

// Opaque cursor for community pagination — base64url of "<isoCreatedAt>|<id>".
// Cursor pagination on (created_at, id) is stable under concurrent inserts.
interface CommunityCursor {
  createdAt: Date;
  id: string;
}

export function encodeCommunityCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCommunityCursor(
  cursor: string | null | undefined,
): CommunityCursor | null {
  if (!cursor || typeof cursor !== "string") return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep < 0) return null;
    const iso = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// University TRAINING drills — score submission + community author badge.
// Member-facing copy says "drills"/"training" (standing owner directive); the
// wire/DB field is `game` / `game_slug` per the frozen cross-repo contract.
// ---------------------------------------------------------------------------

// The six shipped drills. CHECK-gated in the DB (0153), allowlist-validated in
// the route via isTrainingGameSlug.
export const TRAINING_GAME_SLUGS = [
  "reaction-tap",
  "sequence-memory",
  "number-recall",
  "color-word",
  "pattern-grid",
  "circuit",
] as const;
export type TrainingGameSlug = (typeof TRAINING_GAME_SLUGS)[number];

export function isTrainingGameSlug(value: unknown): value is TrainingGameSlug {
  return (
    typeof value === "string" &&
    (TRAINING_GAME_SLUGS as readonly string[]).includes(value)
  );
}

// The community author's training badge. ABSENT (never zeroed) for members
// with no scores and ALWAYS absent for agent-persona members — agents are also
// excluded from the percentile pool (honesty mandate: never fabricate agent
// activity). `pct` is the member's percentile rank 1-99 (higher = better)
// among non-agent members with at least one score.
export interface CommunityTrainingBadge {
  tier: "coral" | "gold" | "silver" | "bronze";
  pct: number;
  plays: number;
}

// Tier thresholds on the member's aggregate (MAX best_score across drills).
const TRAINING_TIER_CORAL_MIN = 900;
const TRAINING_TIER_GOLD_MIN = 750;
const TRAINING_TIER_SILVER_MIN = 600;

function trainingBadgeTier(
  aggregate: number,
): CommunityTrainingBadge["tier"] {
  if (aggregate >= TRAINING_TIER_CORAL_MIN) return "coral";
  if (aggregate >= TRAINING_TIER_GOLD_MIN) return "gold";
  if (aggregate >= TRAINING_TIER_SILVER_MIN) return "silver";
  return "bronze";
}

// pg drivers return either an array or an { rows } envelope depending on path;
// normalize like voice-budget's firstRow does.
function allRows<T>(result: unknown): T[] {
  const envelope = result as { rows?: T[] };
  if (envelope && Array.isArray(envelope.rows)) return envelope.rows;
  if (Array.isArray(result)) return result as T[];
  return [];
}

export interface CommunityAuthor {
  displayName: string;
  handle: string;
  isYou: boolean;
  isMark: boolean;
  // Present only for non-agent members with at least one training score.
  trainingBadge?: CommunityTrainingBadge;
}

// Post types (Spec A). 'statement' is the default catch-all; the wire/DB value
// is the lowercase slug. CHECK-gated in the DB; validated in the service.
export const COMMUNITY_POST_TYPES = ["statement", "question", "idea"] as const;
export type CommunityPostType = (typeof COMMUNITY_POST_TYPES)[number];

// Curated, fixed topic slugs (Spec A). A post has at most one (nullable).
export const COMMUNITY_TOPICS = [
  "wins",
  "tools_workflows",
  "body_mind",
  "building_revenue",
  "meta",
] as const;
export type CommunityTopic = (typeof COMMUNITY_TOPICS)[number];

function isCommunityPostType(value: unknown): value is CommunityPostType {
  return (
    typeof value === "string" &&
    (COMMUNITY_POST_TYPES as readonly string[]).includes(value)
  );
}

function isCommunityTopic(value: unknown): value is CommunityTopic {
  return (
    typeof value === "string" &&
    (COMMUNITY_TOPICS as readonly string[]).includes(value)
  );
}

// Narrow a DB-stored post_type (text column, CHECK-constrained) to the union.
// Any unexpected legacy value falls back to the default 'statement'.
function normalizeStoredPostType(value: string): CommunityPostType {
  return isCommunityPostType(value) ? value : "statement";
}

// Narrow a DB-stored topic (nullable text column, CHECK-constrained) to the
// union or null. Any unexpected value reads back as null (no topic).
function normalizeStoredTopic(value: string | null): CommunityTopic | null {
  return isCommunityTopic(value) ? value : null;
}

// A surfaced answer preview for a collapsed card: the accepted comment's body +
// author, so the resolution renders without fetching the full thread.
export interface CommunityAcceptedAnswer {
  commentId: string;
  body: string;
  author: CommunityAuthor;
}

// Required-reason cap on a support (service-enforced). Owner-confirmed ~500
// chars, matching the report-reason cap.
const COMMUNITY_VOTE_REASON_MAX = 500;

// The idea-support summary attached to an idea post's view (null for non-idea
// posts). `count` is the number of support rows (only ever rises or holds — no
// down/net/negative). `youSupported` carries the viewer's own support (reason)
// or null. Support + reasons are always visible — the signal is only positive,
// so there is nothing to hide.
export interface CommunityIdeaSupport {
  count: number;
  youSupported: { reason: string } | null;
}

// A single supporter-list entry (GET supporters): one member's support with
// their written reason and resolved author label. Always returned (no reveal
// gate — there is nothing to hide).
export interface CommunityIdeaSupporter {
  reason: string;
  author: CommunityAuthor;
  createdAt: Date;
}

export interface CommunityPostView {
  id: string;
  author: CommunityAuthor;
  body: string;
  commentCount: number;
  reactionCount: number;
  youReacted: boolean;
  createdAt: Date;
  postType: CommunityPostType;
  topic: CommunityTopic | null;
  acceptedCommentId: string | null;
  acceptedAnswer: CommunityAcceptedAnswer | null;
  ideaSupport: CommunityIdeaSupport | null;
}

export interface CommunityCommentView {
  id: string;
  postId: string;
  author: CommunityAuthor;
  body: string;
  reactionCount: number;
  youReacted: boolean;
  createdAt: Date;
  isAccepted: boolean;
}

// Default reaction kind for the MVP single "Resonate" reaction.
export const COMMUNITY_DEFAULT_EMOJI = "resonate";

// Clamp a requested page size into the allowed range (default 20, max 50).
export function clampCommunityLimit(raw: unknown, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

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
    // Rex realtime-voice monthly budget for this member (Phase 1: free 3600 s).
    voiceMinutes: {
      remainingSeconds: number;
      limitSeconds: number;
      periodStart: string;
    };
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

// Sentinel lesson_slug for free-form ("Your notes") notes that don't belong to
// any lesson. A standalone note is a row with lesson_slug === this value and a
// client-minted UUID note_key, so the existing (email, lesson_slug, note_key)
// unique index + ON CONFLICT upsert work unchanged. lesson_slug is NEVER null
// (NULL would break ON CONFLICT and silently duplicate).
export const STANDALONE_LESSON_SLUG = "__standalone__";

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
        id: universityMembers.id,
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
      // Rex voice budget for the resolved member (Phase 1: free 3600 s/mo).
      const budget = await voiceBudgetService(db).getVoiceBudget(row.id);
      university = {
        status: row.status,
        memberSince: (row.joinedAt ?? row.createdAt)?.toISOString() ?? null,
        plan: row.plan,
        founding: row.founding,
        voiceMinutes: {
          remainingSeconds: budget.remainingSeconds,
          limitSeconds: budget.limitSeconds,
          periodStart: budget.periodStart,
        },
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

  /**
   * The member's most-recent University (Starwise) Stripe subscription id —
   * the one the billing save-flow (cancel / pause / reactivate) operates on.
   *
   * Reads from `university_subscriptions` (written ONLY by the University
   * checkout/webhook, which authenticate with universityStripeKey()), so the
   * returned id always belongs to the same Stripe account the save-flow uses
   * universityStripeKey() against — the same key/id-pairing guarantee as
   * getUniversityStripeCustomerId(). Matches on account_id OR email (the same
   * durable join keys), ignores status on purpose (a past_due/canceling member
   * still owns a live subscription they may reactivate), and returns the most
   * recently created row. Null when no subscription id has been recorded yet.
   */
  async function getUniversityStripeSubscriptionId(
    accountId: string,
  ): Promise<string | null> {
    const account = await getAccount(accountId);
    if (!account) return null;
    const email = normalizeEmail(account.email);
    const rows = await db
      .select({
        stripeSubscriptionId: universitySubscriptions.stripeSubscriptionId,
      })
      .from(universitySubscriptions)
      .where(
        and(
          or(
            sql`LOWER(${universitySubscriptions.email}) = ${email}`,
            eq(universitySubscriptions.accountId, account.id),
          ),
          sql`${universitySubscriptions.stripeSubscriptionId} IS NOT NULL`,
        ),
      )
      .orderBy(desc(universitySubscriptions.createdAt))
      .limit(1);
    return rows[0]?.stripeSubscriptionId ?? null;
  }

  /**
   * Persist the optional free-text reason a member gives when they cancel from
   * the billing save-flow. Pure feedback log — append-only, never gates access.
   * Carries both the durable email identity and the resolved account_id so the
   * row is attributable before AND after the account link fires (mirrors the
   * email-OR-account_id join keys the rest of University uses).
   */
  async function recordCancelFeedback(
    accountId: string,
    reason: string | null,
  ): Promise<void> {
    const account = await getAccount(accountId);
    if (!account) throw new Error("Account not found");
    await db.insert(universityCancelFeedback).values({
      accountId: account.id,
      email: normalizeEmail(account.email),
      reason: reason && reason.length ? reason : null,
    });
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
   * F2 "Today's Three" — record today's stand-alone check-in. Idempotent per
   * (member, UTC day): a second tap on the same day is an ON CONFLICT DO NOTHING
   * no-op, so the endpoint always returns a clean 200 (never a 409). Returns the
   * fresh progress summary so the caller sees the updated union streak +
   * checkedInToday in a single round-trip (mirrors recordRep).
   */
  async function recordCheckin(
    accountId: string,
    now: Date = new Date(),
  ): Promise<Awaited<ReturnType<typeof getProgressSummary>>> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");

    // utcDayString returns a 'YYYY-MM-DD' STRING (not a JS Date), so this stays
    // clear of the Drizzle-Date-vs-Neon-pooler footgun on the `date` column.
    const checkinDay = utcDayString(now);
    await db
      .insert(universityCheckins)
      .values({
        accountId: identity.accountId,
        email: identity.email,
        checkinDay,
      })
      .onConflictDoNothing({
        target: [universityCheckins.email, universityCheckins.checkinDay],
      });

    return getProgressSummary(accountId, now);
  }

  /**
   * The member's progress summary: current streak, this-week rep count, the
   * weekly goal, and a recent rep list, plus the aggregate fields the
   * `/university` home redesign renders (totalReps, thirtyDayRate, weekByDay,
   * lessonsDone). Streak is computed in code from the distinct rep-days
   * (Rule 5). The existing query already pulls every row for this identity, so
   * the new fields are derived in-memory from that same set — no extra DB
   * round-trips, no n+1.
   */
  async function getProgressSummary(
    accountId: string,
    now: Date = new Date(),
  ): Promise<{
    currentStreak: number;
    /** F2 "Today's Three" — did this member check in today (UTC)? */
    checkedInToday: boolean;
    weekCount: number;
    weekGoal: number;
    recent: Array<{
      lessonSlug: string;
      createdAt: Date;
      reflection: string | null;
    }>;
    totalReps: number;
    thirtyDayRate: number;
    weekByDay: Array<{ dayOffset: number; count: number }>;
    lessonsDone: string[];
  }> {
    const today = utcDayString(now);
    // 7-slot week grid, OLDEST FIRST (dayOffset 0 = today − 6; offset 6 = today).
    const emptyWeekByDay = (): Array<{ dayOffset: number; count: number }> =>
      Array.from({ length: 7 }, (_, i) => ({ dayOffset: i, count: 0 }));

    const identity = await resolveProgressIdentity(accountId);
    if (!identity) {
      return {
        currentStreak: 0,
        checkedInToday: false,
        weekCount: 0,
        weekGoal: weekGoal(),
        recent: [],
        totalReps: 0,
        thirtyDayRate: 0,
        weekByDay: emptyWeekByDay(),
        lessonsDone: [],
      };
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

    // rep_day comes back from the `date` column as a 'YYYY-MM-DD' string.
    const repDays = rows.map((r) => String(r.repDay));

    // F2 "Today's Three" — the streak is a UNION: a day counts if it has a rep
    // OR a stand-alone check-in. Check-ins are keyed the same email-or-account
    // way as reps. Only the STREAK unions; weekCount / weekByDay / totalReps /
    // lessonsDone below stay rep-only (they measure lesson practice, not
    // showing-up). The streak-nudge cron applies the identical union to its
    // at-risk derivation (university-crons.ts) so a checked-in member is never
    // sent a false "your streak is at risk" email.
    const checkinRows = await db
      .select({ checkinDay: universityCheckins.checkinDay })
      .from(universityCheckins)
      .where(
        or(
          sql`LOWER(${universityCheckins.email}) = ${identity.email}`,
          eq(universityCheckins.accountId, identity.accountId),
        ),
      );
    const checkinDays = checkinRows.map((r) => String(r.checkinDay));
    const checkedInToday = checkinDays.includes(today);
    const currentStreak = computeStreak(
      new Set([...repDays, ...checkinDays]),
      today,
    );

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

    // totalReps = every row this identity has ever logged.
    const totalReps = rows.length;

    // 30-day adherence rate: distinct rep-days in the trailing 30-day window
    // (today and the 29 prior UTC days, inclusive) divided by 30, as an
    // integer percent clamped to 0..100.
    const thirtyStart = addUtcDays(today, -29);
    const thirtyDayDays = new Set(
      repDays.filter((d) => d >= thirtyStart && d <= today),
    );
    const thirtyDayRate = Math.max(
      0,
      Math.min(100, Math.round((thirtyDayDays.size / 30) * 100)),
    );

    // weekByDay: 7 slots OLDEST FIRST. Count = distinct lesson rows on that
    // UTC day (rows are already keyed (email, lessonSlug, repDay) uniquely, so
    // a row count per day == distinct lessons repped that day).
    const weekByDay = emptyWeekByDay();
    const perDayCounts = new Map<string, number>();
    for (const d of repDays) {
      if (d < windowStart || d > today) continue;
      perDayCounts.set(d, (perDayCounts.get(d) ?? 0) + 1);
    }
    for (let i = 0; i < 7; i++) {
      const day = addUtcDays(today, i - 6);
      weekByDay[i] = { dayOffset: i, count: perDayCounts.get(day) ?? 0 };
    }

    // lessonsDone: every distinct lessonSlug this identity has ever repped,
    // sorted lexicographically.
    const lessonsDone = Array.from(
      new Set(rows.map((r) => r.lessonSlug)),
    ).sort();

    return {
      currentStreak,
      checkedInToday,
      weekCount,
      weekGoal: weekGoal(),
      recent,
      totalReps,
      thirtyDayRate,
      weekByDay,
      lessonsDone,
    };
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
    title?: string;
  }): Promise<{
    lessonSlug: string;
    noteKey: string;
    body: string;
    title: string | null;
    tags: string[];
    updatedAt: Date;
  }> {
    const identity = await resolveProgressIdentity(args.accountId);
    if (!identity) throw new Error("Account not found");
    const lessonSlug = args.lessonSlug.trim();
    if (!lessonSlug) throw new Error("lessonSlug required");
    const noteKey = args.noteKey.trim();
    if (!noteKey) throw new Error("noteKey required");
    const body = args.body;
    // Only a caller-supplied, non-empty title participates. When omitted we
    // neither insert nor overwrite the title (enrichment / a prior title win).
    const title =
      typeof args.title === "string" && args.title.trim()
        ? args.title.trim()
        : undefined;

    const now = new Date();
    const [row] = await db
      .insert(universityNotes)
      .values({
        accountId: identity.accountId,
        email: identity.email,
        lessonSlug,
        noteKey,
        body,
        ...(title !== undefined ? { title } : {}),
      })
      .onConflictDoUpdate({
        target: [
          universityNotes.email,
          universityNotes.lessonSlug,
          universityNotes.noteKey,
        ],
        set: {
          // Backfill the account link if it resolved after the first save, and
          // refresh the body + updated_at on a re-save. Title is updated only
          // when the caller supplied one — an omitted title is left intact.
          accountId: identity.accountId,
          body,
          ...(title !== undefined ? { title } : {}),
          updatedAt: now,
        },
      })
      .returning({
        lessonSlug: universityNotes.lessonSlug,
        noteKey: universityNotes.noteKey,
        body: universityNotes.body,
        title: universityNotes.title,
        tags: universityNotes.tags,
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
      title: string | null;
      tags: string[];
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
        title: universityNotes.title,
        tags: universityNotes.tags,
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

  /**
   * Apply AI enrichment (tags + optional title) to a member's note. Scoped to
   * the durable identity (email OR account_id) + lesson + note_key so a member
   * can only enrich their own notes. `tags` (when provided) is always written;
   * `title` is filled ONLY when the current row's title IS NULL — a user-set
   * title is never overwritten (COALESCE keeps the existing value). Used by the
   * fire-and-forget enrichment path; a no-op when neither field is provided or
   * the identity can't be resolved.
   */
  async function setNoteEnrichment(args: {
    accountId: string;
    lessonSlug: string;
    noteKey: string;
    title?: string;
    tags?: string[];
  }): Promise<void> {
    const identity = await resolveProgressIdentity(args.accountId);
    if (!identity) return;
    const lessonSlug = args.lessonSlug.trim();
    const noteKey = args.noteKey.trim();
    if (!lessonSlug || !noteKey) return;

    const hasTags = Array.isArray(args.tags);
    const newTitle =
      typeof args.title === "string" && args.title.trim()
        ? args.title.trim()
        : undefined;
    if (!hasTags && newTitle === undefined) return;

    await db
      .update(universityNotes)
      .set({
        ...(hasTags ? { tags: args.tags } : {}),
        // Only fill title when it is still NULL — never clobber a user title.
        ...(newTitle !== undefined
          ? { title: sql`COALESCE(${universityNotes.title}, ${newTitle})` }
          : {}),
      })
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

  // -------------------------------------------------------------------------
  // University Smart Notes — semantic search (embeddings).
  // -------------------------------------------------------------------------
  // The `embedding` column (vector(1024)) is deliberately NOT in the Drizzle
  // schema — all vector ops are raw SQL, like intel_reports / agent_memory.
  // Reads cast to ::halfvec(1024) so a future HNSW halfvec index is usable.
  // Everything is identity-scoped (LOWER(email) OR account_id), exactly like
  // getNotes, so a member can only ever write/see their own notes.

  // Cosine cutoff for a "related" note (ported from Optimize Me; tune later).
  const RELATED_SIMILARITY_FLOOR = 0.3;

  /**
   * Persist a note's embedding (identity-scoped). Raw SQL because the column is
   * out of the Drizzle schema. Called by the fire-and-forget embed-on-save path
   * (apply = this) and the backfill script. No-op on missing identity/keys/vec.
   */
  async function setNoteEmbedding(args: {
    accountId: string;
    lessonSlug: string;
    noteKey: string;
    embedding: number[];
  }): Promise<void> {
    const identity = await resolveProgressIdentity(args.accountId);
    if (!identity) return;
    const lessonSlug = args.lessonSlug.trim();
    const noteKey = args.noteKey.trim();
    if (!lessonSlug || !noteKey) return;
    if (!Array.isArray(args.embedding) || args.embedding.length === 0) return;
    const vec = `[${args.embedding.join(",")}]`;
    await db.execute(sql`
      UPDATE university_notes
      SET embedding = ${vec}::vector
      WHERE (LOWER(email) = ${identity.email} OR account_id = ${identity.accountId})
        AND lesson_slug = ${lessonSlug}
        AND note_key = ${noteKey}
    `);
  }

  /**
   * The member's notes most related to either a source note (pass lessonSlug +
   * noteKey) or free query text (pass queryText). Semantic-first via cosine over
   * ::halfvec(1024); if the embed service is down or nothing is embedded yet it
   * degrades to the ported keyword-overlap fallback (never surfaces an error).
   * Always identity-scoped, source note excluded. Returns [] on missing input.
   *
   * Each result carries `source: "semantic" | "keyword"`. Semantic similarity is
   * cosine in [0,1] (filtered > floor); keyword results carry no cosine score
   * (similarity 0) — distinguish via `source`.
   */
  async function getRelatedNotes(args: {
    accountId: string;
    lessonSlug?: string;
    noteKey?: string;
    queryText?: string;
    limit?: number;
  }): Promise<
    Array<{
      lessonSlug: string;
      noteKey: string;
      body: string;
      title: string | null;
      tags: string[];
      similarity: number;
      source: "semantic" | "keyword";
    }>
  > {
    const identity = await resolveProgressIdentity(args.accountId);
    if (!identity) return [];
    const limit = Math.min(Math.max(1, args.limit ?? 5), 20);

    // Load the member's notes once — needed to resolve a source note's text and
    // to power the keyword fallback. Cheap (members have few notes).
    const notes = await getNotes({ accountId: args.accountId });
    if (notes.length === 0) return [];

    // Resolve the query text + the (lesson, key) to exclude.
    let queryText =
      typeof args.queryText === "string" ? args.queryText.trim() : "";
    let excludeLesson: string | null = null;
    let excludeKey: string | null = null;
    if (!queryText && args.lessonSlug && args.noteKey) {
      excludeLesson = args.lessonSlug.trim();
      excludeKey = args.noteKey.trim();
      const src = notes.find(
        (n) => n.lessonSlug === excludeLesson && n.noteKey === excludeKey,
      );
      if (!src) return [];
      queryText = [src.title ?? "", ...src.tags, src.body].join(" ").trim();
    }
    if (!queryText) return [];

    const others = notes.filter(
      (n) =>
        !(
          excludeLesson !== null &&
          n.lessonSlug === excludeLesson &&
          n.noteKey === excludeKey
        ),
    );
    if (others.length === 0) return [];

    // Semantic-first.
    try {
      const vec = await getEmbedding(queryText);
      const embStr = `[${vec.join(",")}]`;
      const exclude =
        excludeLesson !== null && excludeKey !== null
          ? sql`AND NOT (lesson_slug = ${excludeLesson} AND note_key = ${excludeKey})`
          : sql``;
      const rows = allRows<{
        lesson_slug: string;
        note_key: string;
        body: string;
        title: string | null;
        tags: string[] | null;
        similarity: number | string;
      }>(
        await db.execute(sql`
          SELECT lesson_slug, note_key, body, title, tags,
            1 - (embedding::halfvec(1024) <=> ${embStr}::halfvec(1024)) AS similarity
          FROM university_notes
          WHERE (LOWER(email) = ${identity.email} OR account_id = ${identity.accountId})
            AND embedding IS NOT NULL
            ${exclude}
          ORDER BY embedding::halfvec(1024) <=> ${embStr}::halfvec(1024)
          LIMIT ${limit}
        `),
      );
      const semantic = rows
        .map((r) => ({
          lessonSlug: r.lesson_slug,
          noteKey: r.note_key,
          body: r.body,
          title: r.title,
          tags: Array.isArray(r.tags) ? r.tags : [],
          similarity: Number(r.similarity),
          source: "semantic" as const,
        }))
        .filter(
          (r) =>
            Number.isFinite(r.similarity) &&
            r.similarity > RELATED_SIMILARITY_FLOOR,
        );
      if (semantic.length > 0) return semantic;
      // else: nothing embedded yet / all below floor → keyword fallback.
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "getRelatedNotes: semantic path failed; using keyword fallback",
      );
    }

    // Keyword fallback (ported pure overlap scorer). No cosine score available.
    return scoreNotesByKeyword(queryText, others)
      .slice(0, limit)
      .map((n) => ({
        lessonSlug: n.lessonSlug,
        noteKey: n.noteKey,
        body: n.body,
        title: n.title,
        tags: n.tags,
        similarity: 0,
        source: "keyword" as const,
      }));
  }

  // -------------------------------------------------------------------------
  // University TRAINING drills — best-score upsert.
  // -------------------------------------------------------------------------

  // Resolve the University member row (university_members id) for a portal
  // account — the identity key the training scores table uses (same key as
  // university_voice_meter / university_coherence_checks). Matches on the
  // durable lowercased email OR the linked account_id, newest row first.
  // Status-blind on purpose: the route gate (isUniversityAccount) is also
  // status-blind, so a member who passes the gate always resolves here.
  async function resolveTrainingMemberId(
    accountId: string,
  ): Promise<string | null> {
    const account = await getAccount(accountId);
    if (!account) return null;
    const email = normalizeEmail(account.email);
    const rows = await db
      .select({ id: universityMembers.id })
      .from(universityMembers)
      .where(
        or(
          sql`LOWER(${universityMembers.email}) = ${email}`,
          eq(universityMembers.accountId, accountId),
        ),
      )
      .orderBy(desc(universityMembers.createdAt))
      .limit(1);
    return rows.length ? rows[0].id : null;
  }

  /**
   * Record one finished drill run. Upsert per (member, game):
   *   best_score = GREATEST(existing, incoming)
   *   best_level = the level of the best-scoring run — replaced only when the
   *                incoming score STRICTLY beats the stored best
   *   plays      = plays + 1 on EVERY valid submission
   * The route validates game/level/score (allowlist + integer ranges) before
   * calling; the DB CHECKs (0153) back it up. Scores are never echoed back.
   */
  async function recordTrainingScore(
    accountId: string,
    game: TrainingGameSlug,
    level: number,
    score: number,
  ): Promise<void> {
    const memberId = await resolveTrainingMemberId(accountId);
    if (!memberId) throw new Error("University member not found");
    await db
      .insert(universityTrainingScores)
      .values({
        memberId,
        gameSlug: game,
        bestScore: score,
        bestLevel: level,
        plays: 1,
      })
      .onConflictDoUpdate({
        target: [
          universityTrainingScores.memberId,
          universityTrainingScores.gameSlug,
        ],
        set: {
          // Postgres evaluates every SET expression against the OLD row, so
          // best_level's comparison sees the pre-update best_score regardless
          // of assignment order.
          bestLevel: sql`CASE WHEN EXCLUDED.best_score > ${universityTrainingScores.bestScore} THEN EXCLUDED.best_level ELSE ${universityTrainingScores.bestLevel} END`,
          bestScore: sql`GREATEST(${universityTrainingScores.bestScore}, EXCLUDED.best_score)`,
          plays: sql`${universityTrainingScores.plays} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  // -------------------------------------------------------------------------
  // University native COMMUNITY feed — the "Do, between sessions" beat of the
  // Coherent Loop. Members post short updates, comment on each other, and react
  // ("Resonate"). Identity is the durable email (account_id once the linker has
  // fired); the author display name is resolved at read time from
  // university_members.display_name, falling back to "Coherent One". Moderation
  // is light + owner-run: a member report bumps an open-report count; at the
  // auto-hide threshold the target flips to status='hidden' (reversible).
  // -------------------------------------------------------------------------

  // The auto-hide threshold: N open reports on a target flips it to 'hidden'
  // pending owner review. Env-config'd; defaults to 2 for the early cohort.
  function autoHideThreshold(): number {
    const raw = process.env.COMMUNITY_AUTOHIDE_REPORTS;
    const n = raw ? Number(raw) : 2;
    if (!Number.isFinite(n) || n < 1) return 2;
    return Math.floor(n);
  }

  // Resolve display names for a set of author emails in one query. Returns a
  // map email→displayName, using the most-recent member row's display_name and
  // falling back to "Coherent One" (never the email — owner decision §13).
  async function resolveDisplayNames(
    emails: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = Array.from(new Set(emails.map((e) => normalizeEmail(e))));
    if (unique.length === 0) return out;
    const rows = await db
      .select({
        email: universityMembers.email,
        displayName: universityMembers.displayName,
        createdAt: universityMembers.createdAt,
      })
      .from(universityMembers)
      .where(
        sql`LOWER(${universityMembers.email}) IN (${sql.join(
          unique.map((e) => sql`${e}`),
          sql`, `,
        )})`,
      )
      .orderBy(desc(universityMembers.createdAt));
    for (const row of rows) {
      const key = normalizeEmail(row.email);
      // First row wins (newest first); skip if already set.
      if (out.has(key)) continue;
      const name = row.displayName?.trim();
      out.set(key, name && name.length ? name : COMMUNITY_NAME_FALLBACK);
    }
    // Any author with no member row (shouldn't happen behind the gate, but be
    // safe) still gets the neutral fallback.
    for (const e of unique) if (!out.has(e)) out.set(e, COMMUNITY_NAME_FALLBACK);
    return out;
  }

  // Resolve training badges for a set of author emails in ONE query (no N+1):
  // per non-agent member with at least one score, aggregate = MAX(best_score)
  // across drills, plays = SUM(plays), and percentile via a percent_rank()
  // window computed over the WHOLE non-agent scored pool (the window must see
  // every scored member, so the email filter applies AFTER ranking). Agents
  // (is_agent = true) are excluded from both the pool and the result — their
  // authors never carry a badge (honesty mandate). Returns a map
  // email→badge; unscored emails are simply absent (never a zeroed badge).
  // Mirrors resolveDisplayNames: newest member row wins on a duplicate email.
  async function resolveTrainingBadges(
    emails: string[],
  ): Promise<Map<string, CommunityTrainingBadge>> {
    const out = new Map<string, CommunityTrainingBadge>();
    const unique = Array.from(new Set(emails.map((e) => normalizeEmail(e))));
    if (unique.length === 0) return out;
    const result = await db.execute(sql`
      WITH scored AS (
        SELECT
          LOWER(m.email) AS email,
          m.created_at,
          MAX(s.best_score)::int AS aggregate,
          SUM(s.plays)::int AS plays
        FROM university_training_scores s
        JOIN university_members m ON m.id = s.member_id
        WHERE m.is_agent = false
        GROUP BY m.id
      ),
      ranked AS (
        SELECT
          email,
          created_at,
          aggregate,
          plays,
          percent_rank() OVER (ORDER BY aggregate) AS pr
        FROM scored
      )
      SELECT email, aggregate, plays, pr
      FROM ranked
      WHERE email IN (${sql.join(
        unique.map((e) => sql`${e}`),
        sql`, `,
      )})
      ORDER BY created_at DESC
    `);
    const rows = allRows<{
      email: string;
      aggregate: number | string;
      plays: number | string;
      pr: number | string;
    }>(result);
    for (const row of rows) {
      // First row wins (newest member row first); skip if already set.
      if (out.has(row.email)) continue;
      const aggregate = Number(row.aggregate);
      // percent_rank ∈ [0,1] (0 for a pool of one) → 1-99, higher = better.
      const pct = Math.min(99, Math.max(1, Math.round(Number(row.pr) * 100)));
      out.set(row.email, {
        tier: trainingBadgeTier(aggregate),
        pct,
        plays: Number(row.plays),
      });
    }
    return out;
  }

  function buildAuthor(
    authorEmail: string,
    displayNames: Map<string, string>,
    trainingBadges: Map<string, CommunityTrainingBadge>,
    viewerEmail: string,
  ): CommunityAuthor {
    const email = normalizeEmail(authorEmail);
    return {
      displayName: displayNames.get(email) ?? COMMUNITY_NAME_FALLBACK,
      handle: deriveCommunityHandle(email, displayNames.get(email) ?? null),
      isYou: email === viewerEmail,
      isMark: communityStaffEmails().has(email),
      // Absent (undefined → omitted on the wire) for unscored members and for
      // agent personas — never a zeroed badge.
      trainingBadge: trainingBadges.get(email),
    };
  }

  // Which target ids (of one type) the viewer has reacted to — for `youReacted`.
  async function reactedTargetIds(
    viewerEmail: string,
    targetType: "post" | "comment",
    targetIds: string[],
  ): Promise<Set<string>> {
    const set = new Set<string>();
    if (targetIds.length === 0) return set;
    const rows = await db
      .select({ targetId: universityCommunityReactions.targetId })
      .from(universityCommunityReactions)
      .where(
        and(
          sql`LOWER(${universityCommunityReactions.reactorEmail}) = ${viewerEmail}`,
          eq(universityCommunityReactions.targetType, targetType),
          sql`${universityCommunityReactions.targetId} IN (${sql.join(
            targetIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    for (const r of rows) set.add(r.targetId);
    return set;
  }

  // Resolve the surfaced answer preview for a set of accepted comment ids in one
  // query: comment id → { body, authorEmail }. Only visible comments resolve so
  // a removed answer doesn't surface stale text. The viewer email lets us build
  // the author label (isYou) consistently with the rest of the feed.
  async function resolveAcceptedAnswers(
    acceptedCommentIds: string[],
    viewerEmail: string,
  ): Promise<Map<string, CommunityAcceptedAnswer>> {
    const out = new Map<string, CommunityAcceptedAnswer>();
    const ids = Array.from(new Set(acceptedCommentIds.filter((id) => !!id)));
    if (ids.length === 0) return out;
    const rows = await db
      .select({
        id: universityCommunityComments.id,
        authorEmail: universityCommunityComments.authorEmail,
        body: universityCommunityComments.body,
      })
      .from(universityCommunityComments)
      .where(
        and(
          sql`${universityCommunityComments.id} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          eq(universityCommunityComments.status, "visible"),
        ),
      );
    const answerEmails = rows.map((r) => r.authorEmail);
    const displayNames = await resolveDisplayNames(answerEmails);
    const trainingBadges = await resolveTrainingBadges(answerEmails);
    for (const r of rows) {
      out.set(r.id, {
        commentId: r.id,
        body: r.body,
        author: buildAuthor(r.authorEmail, displayNames, trainingBadges, viewerEmail),
      });
    }
    return out;
  }

  // The ideaSupport summary for a brand-new idea post (zero support): count 0,
  // no viewer support. Non-idea posts get null instead.
  function freshIdeaSupport(
    postType: CommunityPostType,
  ): CommunityIdeaSupport | null {
    if (postType !== "idea") return null;
    return { count: 0, youSupported: null };
  }

  // Resolve the idea-support summary for a set of posts in two grouped queries:
  // support counts for the given idea posts, and the viewer's own support rows.
  // Mirrors resolveAcceptedAnswers — bulk, IN(...) via sql.join, returns a Map.
  // Support is always visible (no reveal gate, no down/net/negative).
  // `ideaPostIds` must already be filtered to post_type='idea' posts.
  async function resolveIdeaSupport(
    ideaPostIds: string[],
    viewerEmail: string,
  ): Promise<Map<string, CommunityIdeaSupport>> {
    const out = new Map<string, CommunityIdeaSupport>();
    const ids = Array.from(new Set(ideaPostIds.filter((id) => !!id)));
    if (ids.length === 0) return out;

    // Per-post support counts in one grouped query.
    const countRows = await db
      .select({
        postId: universityCommunityIdeaVotes.postId,
        c: sql<number>`count(*)::int`,
      })
      .from(universityCommunityIdeaVotes)
      .where(
        sql`${universityCommunityIdeaVotes.postId} IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .groupBy(universityCommunityIdeaVotes.postId);

    // The viewer's own support on each of these posts.
    const mineRows = await db
      .select({
        postId: universityCommunityIdeaVotes.postId,
        reason: universityCommunityIdeaVotes.reason,
      })
      .from(universityCommunityIdeaVotes)
      .where(
        and(
          sql`LOWER(${universityCommunityIdeaVotes.voterEmail}) = ${viewerEmail}`,
          sql`${universityCommunityIdeaVotes.postId} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );

    const counts = new Map<string, number>();
    for (const r of countRows) counts.set(r.postId, Number(r.c));
    const mine = new Map<string, { reason: string }>();
    for (const r of mineRows) mine.set(r.postId, { reason: r.reason });

    for (const id of ids) {
      out.set(id, {
        count: counts.get(id) ?? 0,
        youSupported: mine.get(id) ?? null,
      });
    }
    return out;
  }

  /**
   * The community feed: visible posts, newest first, cursor-paginated on
   * (created_at, id) so it's stable under concurrent inserts. `limit` is
   * clamped 1–50 by the caller. Returns each post with its resolved author
   * label, denormalized counts, and whether the viewer has reacted. The
   * optional `type` / `topic` / `unanswered` filters narrow the stream; with
   * none set the feed behaves exactly as before.
   */
  async function getCommunityFeed(
    accountId: string,
    opts: {
      cursor?: string | null;
      limit: number;
      type?: CommunityPostType | null;
      topic?: CommunityTopic | null;
      unanswered?: boolean;
    },
  ): Promise<{ posts: CommunityPostView[]; nextCursor: string | null }> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) return { posts: [], nextCursor: null };
    const cursor = decodeCommunityCursor(opts.cursor);

    const filters = [eq(universityCommunityPosts.status, "visible")];
    if (cursor) {
      filters.push(
        or(
          lt(universityCommunityPosts.createdAt, cursor.createdAt),
          and(
            eq(universityCommunityPosts.createdAt, cursor.createdAt),
            lt(universityCommunityPosts.id, cursor.id),
          ),
        )!,
      );
    }
    if (opts.type) {
      filters.push(eq(universityCommunityPosts.postType, opts.type));
    }
    if (opts.topic) {
      filters.push(eq(universityCommunityPosts.topic, opts.topic));
    }
    if (opts.unanswered) {
      // The Open-questions board: open (unanswered) questions only.
      filters.push(eq(universityCommunityPosts.postType, "question"));
      filters.push(isNull(universityCommunityPosts.acceptedCommentId));
    }
    const where = and(...filters);

    const rows = await db
      .select({
        id: universityCommunityPosts.id,
        authorEmail: universityCommunityPosts.authorEmail,
        body: universityCommunityPosts.body,
        commentCount: universityCommunityPosts.commentCount,
        reactionCount: universityCommunityPosts.reactionCount,
        createdAt: universityCommunityPosts.createdAt,
        postType: universityCommunityPosts.postType,
        topic: universityCommunityPosts.topic,
        acceptedCommentId: universityCommunityPosts.acceptedCommentId,
      })
      .from(universityCommunityPosts)
      .where(where)
      .orderBy(
        desc(universityCommunityPosts.createdAt),
        desc(universityCommunityPosts.id),
      )
      .limit(opts.limit + 1);

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const displayNames = await resolveDisplayNames(
      page.map((r) => r.authorEmail),
    );
    const trainingBadges = await resolveTrainingBadges(
      page.map((r) => r.authorEmail),
    );
    const reacted = await reactedTargetIds(
      identity.email,
      "post",
      page.map((r) => r.id),
    );
    const acceptedAnswers = await resolveAcceptedAnswers(
      page
        .map((r) => r.acceptedCommentId)
        .filter((id): id is string => !!id),
      identity.email,
    );
    const ideaSupport = await resolveIdeaSupport(
      page
        .filter((r) => normalizeStoredPostType(r.postType) === "idea")
        .map((r) => r.id),
      identity.email,
    );

    const posts: CommunityPostView[] = page.map((r) => ({
      id: r.id,
      author: buildAuthor(r.authorEmail, displayNames, trainingBadges, identity.email),
      body: r.body,
      commentCount: r.commentCount,
      reactionCount: r.reactionCount,
      youReacted: reacted.has(r.id),
      createdAt: r.createdAt,
      postType: normalizeStoredPostType(r.postType),
      topic: normalizeStoredTopic(r.topic),
      acceptedCommentId: r.acceptedCommentId ?? null,
      acceptedAnswer: r.acceptedCommentId
        ? acceptedAnswers.get(r.acceptedCommentId) ?? null
        : null,
      ideaSupport:
        normalizeStoredPostType(r.postType) === "idea"
          ? ideaSupport.get(r.id) ?? freshIdeaSupport("idea")
          : null,
    }));

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCommunityCursor(last.createdAt, last.id) : null;
    return { posts, nextCursor };
  }

  /**
   * Create a top-level post. Body is trimmed + length-validated by the caller;
   * the deterministic profanity gate runs here (code, not an LLM) and throws a
   * CommunityError(422) on a hit — fail loud to the author, never a silent drop.
   */
  async function createCommunityPost(
    accountId: string,
    bodyRaw: string,
    postTypeRaw?: string | null,
    topicRaw?: string | null,
    opts?: {
      // Optional hook run inside the SAME transaction as the post insert, after
      // the row exists. Throwing rolls the whole insert back. Used by the agent
      // runner to commit its durable posting ledger atomically with the post so
      // a restart mid-tick can't double-post; real-member callers omit it and
      // hit the unchanged single-insert path below.
      onInsertTx?: (
        tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
        row: { id: string; authorEmail: string; createdAt: Date },
      ) => Promise<void>;
    },
  ): Promise<CommunityPostView> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    const body = bodyRaw.trim();
    if (!body) throw new CommunityError(400, "Post body required");
    if (body.length > COMMUNITY_POST_MAX) {
      throw new CommunityError(
        400,
        `Post must be at most ${COMMUNITY_POST_MAX} characters`,
      );
    }
    if (isCommunityProfane(body)) throw new CommunityError(422, "profanity");

    // post_type defaults to 'statement' when omitted; an explicit bad value is
    // a 400 (no row written). topic is optional/nullable; an explicit bad value
    // is a 400. Empty-string topic is treated as "no topic".
    let postType: CommunityPostType = "statement";
    if (postTypeRaw !== undefined && postTypeRaw !== null) {
      if (!isCommunityPostType(postTypeRaw)) {
        throw new CommunityError(400, "Invalid postType");
      }
      postType = postTypeRaw;
    }
    let topic: CommunityTopic | null = null;
    if (topicRaw !== undefined && topicRaw !== null && topicRaw !== "") {
      if (!isCommunityTopic(topicRaw)) {
        throw new CommunityError(400, "Invalid topic");
      }
      topic = topicRaw;
    }

    const insertValues = {
      accountId: identity.accountId,
      authorEmail: identity.email,
      body,
      postType,
      topic,
    };
    const returning = {
      id: universityCommunityPosts.id,
      authorEmail: universityCommunityPosts.authorEmail,
      body: universityCommunityPosts.body,
      commentCount: universityCommunityPosts.commentCount,
      reactionCount: universityCommunityPosts.reactionCount,
      createdAt: universityCommunityPosts.createdAt,
      postType: universityCommunityPosts.postType,
      topic: universityCommunityPosts.topic,
      acceptedCommentId: universityCommunityPosts.acceptedCommentId,
    };
    // With an onInsertTx hook, the insert and the hook's writes commit together
    // (or roll back together if the hook throws). Without it, the real-member
    // path is the unchanged single insert.
    const row = opts?.onInsertTx
      ? await db.transaction(async (tx) => {
          const [r] = await tx
            .insert(universityCommunityPosts)
            .values(insertValues)
            .returning(returning);
          await opts.onInsertTx!(tx, {
            id: r.id,
            authorEmail: r.authorEmail,
            createdAt: r.createdAt,
          });
          return r;
        })
      : (await db.insert(universityCommunityPosts).values(insertValues).returning(returning))[0];
    const displayNames = await resolveDisplayNames([row.authorEmail]);
    const trainingBadges = await resolveTrainingBadges([row.authorEmail]);
    return {
      id: row.id,
      author: buildAuthor(row.authorEmail, displayNames, trainingBadges, identity.email),
      body: row.body,
      commentCount: row.commentCount,
      reactionCount: row.reactionCount,
      youReacted: false,
      createdAt: row.createdAt,
      postType: normalizeStoredPostType(row.postType),
      topic: normalizeStoredTopic(row.topic),
      acceptedCommentId: row.acceptedCommentId ?? null,
      // A freshly created post is never answered.
      acceptedAnswer: null,
      // A freshly created idea has zero support; non-ideas → null.
      ideaSupport: freshIdeaSupport(normalizeStoredPostType(row.postType)),
    };
  }

  /**
   * Post detail + its visible comments (oldest first, cursor-paginated). Throws
   * CommunityError(404) if the post is missing or not visible.
   */
  async function getCommunityPost(
    accountId: string,
    postId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<{
    post: CommunityPostView;
    comments: CommunityCommentView[];
    nextCursor: string | null;
  }> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");

    const [post] = await db
      .select({
        id: universityCommunityPosts.id,
        authorEmail: universityCommunityPosts.authorEmail,
        body: universityCommunityPosts.body,
        commentCount: universityCommunityPosts.commentCount,
        reactionCount: universityCommunityPosts.reactionCount,
        createdAt: universityCommunityPosts.createdAt,
        postType: universityCommunityPosts.postType,
        topic: universityCommunityPosts.topic,
        acceptedCommentId: universityCommunityPosts.acceptedCommentId,
      })
      .from(universityCommunityPosts)
      .where(
        and(
          eq(universityCommunityPosts.id, postId),
          eq(universityCommunityPosts.status, "visible"),
        ),
      )
      .limit(1);
    if (!post) throw new CommunityError(404, "Post not found");

    const cursor = decodeCommunityCursor(opts.cursor);
    const commentWhere = cursor
      ? and(
          eq(universityCommunityComments.postId, postId),
          eq(universityCommunityComments.status, "visible"),
          or(
            sql`${universityCommunityComments.createdAt} > ${cursor.createdAt}`,
            and(
              eq(universityCommunityComments.createdAt, cursor.createdAt),
              sql`${universityCommunityComments.id} > ${cursor.id}`,
            ),
          ),
        )
      : and(
          eq(universityCommunityComments.postId, postId),
          eq(universityCommunityComments.status, "visible"),
        );

    const commentRows = await db
      .select({
        id: universityCommunityComments.id,
        postId: universityCommunityComments.postId,
        authorEmail: universityCommunityComments.authorEmail,
        body: universityCommunityComments.body,
        createdAt: universityCommunityComments.createdAt,
      })
      .from(universityCommunityComments)
      .where(commentWhere)
      .orderBy(
        asc(universityCommunityComments.createdAt),
        asc(universityCommunityComments.id),
      )
      .limit(opts.limit + 1);

    const hasMore = commentRows.length > opts.limit;
    const page = hasMore ? commentRows.slice(0, opts.limit) : commentRows;

    const threadEmails = [post.authorEmail, ...page.map((c) => c.authorEmail)];
    const displayNames = await resolveDisplayNames(threadEmails);
    const trainingBadges = await resolveTrainingBadges(threadEmails);
    const postReacted = await reactedTargetIds(identity.email, "post", [
      post.id,
    ]);
    const commentReacted = await reactedTargetIds(
      identity.email,
      "comment",
      page.map((c) => c.id),
    );
    // Per-comment reaction counts (a small N — one grouped query).
    const commentReactionCounts = await communityReactionCounts(
      "comment",
      page.map((c) => c.id),
    );

    const acceptedAnswers = post.acceptedCommentId
      ? await resolveAcceptedAnswers([post.acceptedCommentId], identity.email)
      : new Map<string, CommunityAcceptedAnswer>();
    const postIsIdea = normalizeStoredPostType(post.postType) === "idea";
    const ideaSupport = postIsIdea
      ? await resolveIdeaSupport([post.id], identity.email)
      : new Map<string, CommunityIdeaSupport>();
    const postView: CommunityPostView = {
      id: post.id,
      author: buildAuthor(post.authorEmail, displayNames, trainingBadges, identity.email),
      body: post.body,
      commentCount: post.commentCount,
      reactionCount: post.reactionCount,
      youReacted: postReacted.has(post.id),
      createdAt: post.createdAt,
      postType: normalizeStoredPostType(post.postType),
      topic: normalizeStoredTopic(post.topic),
      acceptedCommentId: post.acceptedCommentId ?? null,
      acceptedAnswer: post.acceptedCommentId
        ? acceptedAnswers.get(post.acceptedCommentId) ?? null
        : null,
      ideaSupport: postIsIdea
        ? ideaSupport.get(post.id) ?? freshIdeaSupport("idea")
        : null,
    };
    const comments: CommunityCommentView[] = page.map((c) => ({
      id: c.id,
      postId: c.postId,
      author: buildAuthor(c.authorEmail, displayNames, trainingBadges, identity.email),
      body: c.body,
      reactionCount: commentReactionCounts.get(c.id) ?? 0,
      youReacted: commentReacted.has(c.id),
      createdAt: c.createdAt,
      // A comment is "the answer" iff the post points at it.
      isAccepted: c.id === post.acceptedCommentId,
    }));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCommunityCursor(last.createdAt, last.id) : null;
    return { post: postView, comments, nextCursor };
  }

  // Grouped reaction counts for a set of targets of one type.
  async function communityReactionCounts(
    targetType: "post" | "comment",
    targetIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (targetIds.length === 0) return out;
    const rows = await db
      .select({
        targetId: universityCommunityReactions.targetId,
        c: sql<number>`count(*)::int`,
      })
      .from(universityCommunityReactions)
      .where(
        and(
          eq(universityCommunityReactions.targetType, targetType),
          sql`${universityCommunityReactions.targetId} IN (${sql.join(
            targetIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      )
      .groupBy(universityCommunityReactions.targetId);
    for (const r of rows) out.set(r.targetId, Number(r.c));
    return out;
  }

  /**
   * Author-only soft delete of a post → status='removed' (kept for audit, never
   * rendered). Returns false if the post isn't the caller's (or doesn't exist).
   */
  async function deleteCommunityPost(
    accountId: string,
    postId: string,
  ): Promise<boolean> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    const result = await db
      .update(universityCommunityPosts)
      .set({ status: "removed", hiddenReason: "author", updatedAt: new Date() })
      .where(
        and(
          eq(universityCommunityPosts.id, postId),
          sql`LOWER(${universityCommunityPosts.authorEmail}) = ${identity.email}`,
          sql`${universityCommunityPosts.status} <> 'removed'`,
        ),
      )
      .returning({ id: universityCommunityPosts.id });
    return result.length > 0;
  }

  /**
   * Add a comment to a visible post. Profanity-gated (422). Bumps the post's
   * denormalized comment_count in the SAME transaction as the insert, and
   * writes a reply notification for the post author (suppressed for self-reply).
   */
  async function createCommunityComment(
    accountId: string,
    postId: string,
    bodyRaw: string,
  ): Promise<CommunityCommentView> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    const body = bodyRaw.trim();
    if (!body) throw new CommunityError(400, "Comment body required");
    if (body.length > COMMUNITY_COMMENT_MAX) {
      throw new CommunityError(
        400,
        `Comment must be at most ${COMMUNITY_COMMENT_MAX} characters`,
      );
    }
    if (isCommunityProfane(body)) throw new CommunityError(422, "profanity");

    const inserted = await db.transaction(async (tx) => {
      const [post] = await tx
        .select({
          id: universityCommunityPosts.id,
          authorEmail: universityCommunityPosts.authorEmail,
          accountId: universityCommunityPosts.accountId,
        })
        .from(universityCommunityPosts)
        .where(
          and(
            eq(universityCommunityPosts.id, postId),
            eq(universityCommunityPosts.status, "visible"),
          ),
        )
        .limit(1);
      if (!post) throw new CommunityError(404, "Post not found");

      const [comment] = await tx
        .insert(universityCommunityComments)
        .values({
          postId,
          accountId: identity.accountId,
          authorEmail: identity.email,
          body,
        })
        .returning({
          id: universityCommunityComments.id,
          postId: universityCommunityComments.postId,
          authorEmail: universityCommunityComments.authorEmail,
          body: universityCommunityComments.body,
          createdAt: universityCommunityComments.createdAt,
        });

      await tx
        .update(universityCommunityPosts)
        .set({
          commentCount: sql`${universityCommunityPosts.commentCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(universityCommunityPosts.id, postId));

      // Reply notification — never notify the author about their own comment,
      // and never notify an agent persona (agent+<key>@…): agents don't read
      // notifications and the reply email has no valid inbox to reach.
      const recipientEmail = normalizeEmail(post.authorEmail);
      if (recipientEmail !== identity.email && !recipientEmail.startsWith("agent+")) {
        await tx.insert(universityCommunityNotifications).values({
          accountId: post.accountId,
          recipientEmail,
          actorEmail: identity.email,
          kind: "reply",
          postId,
          commentId: comment.id,
        });
      }
      return { comment, post };
    });

    // Best-effort email reply notification (storefront template is owner-gated;
    // sendCreditscoreEmail warn-and-continues if the kind/template isn't wired).
    const recipientEmail = normalizeEmail(inserted.post.authorEmail);
    // Suppress the reply email for agent personas (agent+<key>@…) — no real
    // inbox, and it would 4xx the storefront receiver. Real members only.
    if (recipientEmail !== identity.email && !recipientEmail.startsWith("agent+")) {
      void sendCommunityReplyEmail({
        recipientEmail,
        postId,
        snippet: inserted.comment.body.slice(0, 140),
      });
    }

    const displayNames = await resolveDisplayNames([inserted.comment.authorEmail]);
    const trainingBadges = await resolveTrainingBadges([
      inserted.comment.authorEmail,
    ]);
    return {
      id: inserted.comment.id,
      postId: inserted.comment.postId,
      author: buildAuthor(
        inserted.comment.authorEmail,
        displayNames,
        trainingBadges,
        identity.email,
      ),
      body: inserted.comment.body,
      reactionCount: 0,
      youReacted: false,
      createdAt: inserted.comment.createdAt,
      // A freshly created comment is never the accepted answer.
      isAccepted: false,
    };
  }

  /**
   * Author-only soft delete of a comment → status='removed'. Decrements the
   * post's comment_count in the same transaction. Returns false if the comment
   * isn't the caller's (or doesn't exist / already removed).
   */
  async function deleteCommunityComment(
    accountId: string,
    commentId: string,
  ): Promise<boolean> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    return db.transaction(async (tx) => {
      const removed = await tx
        .update(universityCommunityComments)
        .set({
          status: "removed",
          hiddenReason: "author",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(universityCommunityComments.id, commentId),
            sql`LOWER(${universityCommunityComments.authorEmail}) = ${identity.email}`,
            eq(universityCommunityComments.status, "visible"),
          ),
        )
        .returning({ postId: universityCommunityComments.postId });
      if (removed.length === 0) return false;
      const postId = removed[0].postId;
      await tx
        .update(universityCommunityPosts)
        .set({
          commentCount: sql`GREATEST(${universityCommunityPosts.commentCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(universityCommunityPosts.id, postId));
      // If this comment was the post's accepted answer, revert the post to open
      // in the SAME transaction (a removed answer must not surface as resolved).
      await tx
        .update(universityCommunityPosts)
        .set({ acceptedCommentId: null, updatedAt: new Date() })
        .where(
          and(
            eq(universityCommunityPosts.id, postId),
            eq(universityCommunityPosts.acceptedCommentId, commentId),
          ),
        );
      return true;
    });
  }

  // The moderator set for accept-answer eligibility. Empty until Spec C ships
  // the moderator role; the canAcceptAnswer branch then resolves moderators
  // here with no rework elsewhere. SEAM: Spec C populates this.
  function communityModeratorEmails(): Set<string> {
    return new Set();
  }

  /**
   * Who may accept an answer on a question (Spec A): the asker (post author) OR
   * the owner/staff OR a moderator. Moderators are an empty set until Spec C, so
   * today the effective accepters are asker + owner/staff; moderators gain the
   * power automatically once the role lands. All emails compared normalized.
   */
  function canAcceptAnswer(
    callerEmail: string,
    post: { authorEmail: string },
  ): boolean {
    const caller = normalizeEmail(callerEmail);
    if (caller === normalizeEmail(post.authorEmail)) return true;
    if (communityStaffEmails().has(caller)) return true;
    // SEAM (Spec C): moderators inherit accept rights here.
    if (communityModeratorEmails().has(caller)) return true;
    return false;
  }

  // Build a CommunityPostView for a single visible post id (no comments). Used
  // to return the refreshed post after accept/unaccept. Throws 404 if missing.
  async function buildPostViewById(
    postId: string,
    viewerEmail: string,
  ): Promise<CommunityPostView> {
    const [post] = await db
      .select({
        id: universityCommunityPosts.id,
        authorEmail: universityCommunityPosts.authorEmail,
        body: universityCommunityPosts.body,
        commentCount: universityCommunityPosts.commentCount,
        reactionCount: universityCommunityPosts.reactionCount,
        createdAt: universityCommunityPosts.createdAt,
        postType: universityCommunityPosts.postType,
        topic: universityCommunityPosts.topic,
        acceptedCommentId: universityCommunityPosts.acceptedCommentId,
      })
      .from(universityCommunityPosts)
      .where(
        and(
          eq(universityCommunityPosts.id, postId),
          eq(universityCommunityPosts.status, "visible"),
        ),
      )
      .limit(1);
    if (!post) throw new CommunityError(404, "Post not found");
    const displayNames = await resolveDisplayNames([post.authorEmail]);
    const trainingBadges = await resolveTrainingBadges([post.authorEmail]);
    const reacted = await reactedTargetIds(viewerEmail, "post", [post.id]);
    const acceptedAnswers = post.acceptedCommentId
      ? await resolveAcceptedAnswers([post.acceptedCommentId], viewerEmail)
      : new Map<string, CommunityAcceptedAnswer>();
    const postIsIdea = normalizeStoredPostType(post.postType) === "idea";
    const ideaSupport = postIsIdea
      ? await resolveIdeaSupport([post.id], viewerEmail)
      : new Map<string, CommunityIdeaSupport>();
    return {
      id: post.id,
      author: buildAuthor(post.authorEmail, displayNames, trainingBadges, viewerEmail),
      body: post.body,
      commentCount: post.commentCount,
      reactionCount: post.reactionCount,
      youReacted: reacted.has(post.id),
      createdAt: post.createdAt,
      postType: normalizeStoredPostType(post.postType),
      topic: normalizeStoredTopic(post.topic),
      acceptedCommentId: post.acceptedCommentId ?? null,
      ideaSupport: postIsIdea
        ? ideaSupport.get(post.id) ?? freshIdeaSupport("idea")
        : null,
      acceptedAnswer: post.acceptedCommentId
        ? acceptedAnswers.get(post.acceptedCommentId) ?? null
        : null,
    };
  }

  /**
   * Mark a comment as the accepted answer to a question. Gated by
   * canAcceptAnswer (asker / owner / moderator → else 403). The post must be a
   * 'question' (else 400) and the comment must belong to it and be visible
   * (else 404). Idempotent: re-accepting the same comment is a no-op. On a NEW
   * acceptance, inserts a kind='accepted' notification to the answerer (never
   * self). Returns the refreshed post view.
   */
  async function acceptCommunityAnswer(
    accountId: string,
    postId: string,
    commentId: string,
  ): Promise<CommunityPostView> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");

    await db.transaction(async (tx) => {
      const [post] = await tx
        .select({
          id: universityCommunityPosts.id,
          authorEmail: universityCommunityPosts.authorEmail,
          postType: universityCommunityPosts.postType,
          acceptedCommentId: universityCommunityPosts.acceptedCommentId,
        })
        .from(universityCommunityPosts)
        .where(
          and(
            eq(universityCommunityPosts.id, postId),
            eq(universityCommunityPosts.status, "visible"),
          ),
        )
        .limit(1);
      if (!post) throw new CommunityError(404, "Post not found");
      if (!canAcceptAnswer(identity.email, post)) {
        throw new CommunityError(403, "Not allowed to accept an answer");
      }
      if (post.postType !== "question") {
        throw new CommunityError(400, "Only questions can be answered");
      }

      const [comment] = await tx
        .select({
          id: universityCommunityComments.id,
          authorEmail: universityCommunityComments.authorEmail,
          accountId: universityCommunityComments.accountId,
        })
        .from(universityCommunityComments)
        .where(
          and(
            eq(universityCommunityComments.id, commentId),
            eq(universityCommunityComments.postId, postId),
            eq(universityCommunityComments.status, "visible"),
          ),
        )
        .limit(1);
      if (!comment) throw new CommunityError(404, "Comment not found");

      // Idempotent: already the accepted answer → no-op (no duplicate notify).
      if (post.acceptedCommentId === commentId) return;

      await tx
        .update(universityCommunityPosts)
        .set({ acceptedCommentId: commentId, updatedAt: new Date() })
        .where(eq(universityCommunityPosts.id, postId));

      // "Your help mattered" notification to the answerer — never notify self,
      // and never an agent persona (agent+<key>@… don't consume notifications).
      const recipientEmail = normalizeEmail(comment.authorEmail);
      if (recipientEmail !== identity.email && !recipientEmail.startsWith("agent+")) {
        await tx.insert(universityCommunityNotifications).values({
          accountId: comment.accountId,
          recipientEmail,
          actorEmail: identity.email,
          kind: "accepted",
          postId,
          commentId,
        });
      }
    });

    return buildPostViewById(postId, identity.email);
  }

  /**
   * Clear the accepted answer on a question, reverting it to open. Same
   * canAcceptAnswer gate. Idempotent: clearing an already-open question is a
   * no-op. Returns the refreshed post view.
   */
  async function unacceptCommunityAnswer(
    accountId: string,
    postId: string,
  ): Promise<CommunityPostView> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");

    await db.transaction(async (tx) => {
      const [post] = await tx
        .select({
          id: universityCommunityPosts.id,
          authorEmail: universityCommunityPosts.authorEmail,
          postType: universityCommunityPosts.postType,
          acceptedCommentId: universityCommunityPosts.acceptedCommentId,
        })
        .from(universityCommunityPosts)
        .where(
          and(
            eq(universityCommunityPosts.id, postId),
            eq(universityCommunityPosts.status, "visible"),
          ),
        )
        .limit(1);
      if (!post) throw new CommunityError(404, "Post not found");
      if (!canAcceptAnswer(identity.email, post)) {
        throw new CommunityError(403, "Not allowed to un-accept an answer");
      }
      if (post.postType !== "question") {
        throw new CommunityError(400, "Only questions can be answered");
      }
      // Idempotent: already open → no-op.
      if (!post.acceptedCommentId) return;

      await tx
        .update(universityCommunityPosts)
        .set({ acceptedCommentId: null, updatedAt: new Date() })
        .where(eq(universityCommunityPosts.id, postId));
    });

    return buildPostViewById(postId, identity.email);
  }

  /**
   * Who may support an idea (Spec B): any active member EXCEPT the idea's own
   * author. Membership is enforced upstream (requireUniversityMember); the only
   * extra gate here is the author-self exclusion. `post.postType` must be an
   * 'idea' — non-idea posts have no support control. All emails compared
   * normalized.
   */
  function canSupportIdea(
    callerEmail: string,
    post: { authorEmail: string; postType: CommunityPostType },
  ): boolean {
    if (post.postType !== "idea") return false;
    const caller = normalizeEmail(callerEmail);
    return caller !== normalizeEmail(post.authorEmail);
  }

  /**
   * Record (or update) the caller's support for an idea. Upserts on
   * (voter_email, post_id): a first support INSERTs, a re-support UPDATEs the
   * reason in place — one row per member, never double-counts. Gates: non-idea
   * → 400, author-self → 403, empty/whitespace reason → 422, profane reason →
   * 422, over-cap reason → 422. Returns the refreshed post view (with the
   * resolved ideaSupport summary).
   */
  async function supportIdea(
    accountId: string,
    postId: string,
    reasonRaw: string,
  ): Promise<CommunityPostView> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");

    const reason = reasonRaw.trim();
    if (!reason) throw new CommunityError(422, "A reason is required");
    if (reason.length > COMMUNITY_VOTE_REASON_MAX) {
      throw new CommunityError(
        422,
        `Reason must be at most ${COMMUNITY_VOTE_REASON_MAX} characters`,
      );
    }
    if (isCommunityProfane(reason)) throw new CommunityError(422, "profanity");

    const [post] = await db
      .select({
        id: universityCommunityPosts.id,
        authorEmail: universityCommunityPosts.authorEmail,
        postType: universityCommunityPosts.postType,
      })
      .from(universityCommunityPosts)
      .where(
        and(
          eq(universityCommunityPosts.id, postId),
          eq(universityCommunityPosts.status, "visible"),
        ),
      )
      .limit(1);
    if (!post) throw new CommunityError(404, "Post not found");
    if (normalizeStoredPostType(post.postType) !== "idea") {
      throw new CommunityError(400, "Only ideas can be supported");
    }
    if (
      !canSupportIdea(identity.email, {
        authorEmail: post.authorEmail,
        postType: "idea",
      })
    ) {
      throw new CommunityError(403, "You can't support your own idea");
    }

    // Upsert on the unique (voter_email, post_id): insert, or update the
    // existing row's reason. One row per member — re-supporting just rewrites
    // the reason, never double-counts.
    await db
      .insert(universityCommunityIdeaVotes)
      .values({
        postId,
        accountId: identity.accountId,
        voterEmail: identity.email,
        reason,
      })
      .onConflictDoUpdate({
        target: [
          universityCommunityIdeaVotes.voterEmail,
          universityCommunityIdeaVotes.postId,
        ],
        set: { reason, updatedAt: new Date() },
      });

    return buildPostViewById(postId, identity.email);
  }

  /**
   * Retract the caller's support for an idea: deletes their row. Idempotent —
   * if no row exists it's a no-op. Returns the refreshed post view. (A retracted
   * support carries no audit value, like a withdrawn reaction, so the row is
   * deleted.)
   */
  async function unsupportIdea(
    accountId: string,
    postId: string,
  ): Promise<CommunityPostView> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");

    await db
      .delete(universityCommunityIdeaVotes)
      .where(
        and(
          sql`LOWER(${universityCommunityIdeaVotes.voterEmail}) = ${identity.email}`,
          eq(universityCommunityIdeaVotes.postId, postId),
        ),
      );

    return buildPostViewById(postId, identity.email);
  }

  /**
   * The supporter list for an idea (Spec B): each supporter's reason + resolved
   * author, newest first, cursor-paginated on (created_at, id) like the rest of
   * the feed. Always returned — there is no reveal gate (the signal is only
   * positive, so there is nothing to hide). A non-idea or missing post yields an
   * empty list.
   */
  async function listIdeaSupporters(
    accountId: string,
    postId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<{
    supporters: CommunityIdeaSupporter[];
    nextCursor: string | null;
  }> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) return { supporters: [], nextCursor: null };

    const [post] = await db
      .select({
        id: universityCommunityPosts.id,
        postType: universityCommunityPosts.postType,
      })
      .from(universityCommunityPosts)
      .where(
        and(
          eq(universityCommunityPosts.id, postId),
          eq(universityCommunityPosts.status, "visible"),
        ),
      )
      .limit(1);
    if (!post || normalizeStoredPostType(post.postType) !== "idea") {
      return { supporters: [], nextCursor: null };
    }

    const cursor = decodeCommunityCursor(opts.cursor);
    const supportWhere = cursor
      ? and(
          eq(universityCommunityIdeaVotes.postId, postId),
          or(
            lt(universityCommunityIdeaVotes.createdAt, cursor.createdAt),
            and(
              eq(universityCommunityIdeaVotes.createdAt, cursor.createdAt),
              lt(universityCommunityIdeaVotes.id, cursor.id),
            ),
          ),
        )
      : eq(universityCommunityIdeaVotes.postId, postId);

    const rows = await db
      .select({
        id: universityCommunityIdeaVotes.id,
        authorEmail: universityCommunityIdeaVotes.voterEmail,
        reason: universityCommunityIdeaVotes.reason,
        createdAt: universityCommunityIdeaVotes.createdAt,
      })
      .from(universityCommunityIdeaVotes)
      .where(supportWhere)
      .orderBy(
        desc(universityCommunityIdeaVotes.createdAt),
        desc(universityCommunityIdeaVotes.id),
      )
      .limit(opts.limit + 1);

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const displayNames = await resolveDisplayNames(
      page.map((r) => r.authorEmail),
    );
    const trainingBadges = await resolveTrainingBadges(
      page.map((r) => r.authorEmail),
    );
    const supporters: CommunityIdeaSupporter[] = page.map((r) => ({
      reason: r.reason,
      author: buildAuthor(r.authorEmail, displayNames, trainingBadges, identity.email),
      createdAt: r.createdAt,
    }));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCommunityCursor(last.createdAt, last.id) : null;
    return { supporters, nextCursor };
  }

  // Verify a polymorphic target exists + is visible (integrity for reactions /
  // reports, which carry no FK on target_id).
  async function communityTargetIsVisible(
    targetType: "post" | "comment",
    targetId: string,
  ): Promise<boolean> {
    if (targetType === "post") {
      const [r] = await db
        .select({ id: universityCommunityPosts.id })
        .from(universityCommunityPosts)
        .where(
          and(
            eq(universityCommunityPosts.id, targetId),
            eq(universityCommunityPosts.status, "visible"),
          ),
        )
        .limit(1);
      return !!r;
    }
    const [r] = await db
      .select({ id: universityCommunityComments.id })
      .from(universityCommunityComments)
      .where(
        and(
          eq(universityCommunityComments.id, targetId),
          eq(universityCommunityComments.status, "visible"),
        ),
      )
      .limit(1);
    return !!r;
  }

  /**
   * Add a reaction ("Resonate"). Idempotent on the unique key — a double-tap is
   * a no-op (ON CONFLICT DO NOTHING), not an error. Bumps the denormalized
   * reaction_count on a post only when a NEW row was inserted. Returns the
   * current count + youReacted:true.
   */
  async function reactToCommunity(
    accountId: string,
    targetType: "post" | "comment",
    targetId: string,
    emoji: string,
  ): Promise<{ reactionCount: number; youReacted: boolean }> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    if (!(await communityTargetIsVisible(targetType, targetId))) {
      throw new CommunityError(404, "Target not found");
    }
    // Resonate is replaced by support on idea POSTS (Spec B): a post-target
    // reaction on an idea is rejected. Reactions on COMMENTS under an idea (or
    // on statement/question posts) are untouched.
    if (targetType === "post") {
      const [target] = await db
        .select({ postType: universityCommunityPosts.postType })
        .from(universityCommunityPosts)
        .where(eq(universityCommunityPosts.id, targetId))
        .limit(1);
      if (target && normalizeStoredPostType(target.postType) === "idea") {
        throw new CommunityError(400, "ideas use support");
      }
    }
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(universityCommunityReactions)
        .values({
          accountId: identity.accountId,
          reactorEmail: identity.email,
          targetType,
          targetId,
          emoji,
        })
        .onConflictDoNothing({
          target: [
            universityCommunityReactions.reactorEmail,
            universityCommunityReactions.targetType,
            universityCommunityReactions.targetId,
            universityCommunityReactions.emoji,
          ],
        })
        .returning({ id: universityCommunityReactions.id });
      // Only bump the post counter on a genuinely new reaction.
      if (inserted.length > 0 && targetType === "post") {
        await tx
          .update(universityCommunityPosts)
          .set({
            reactionCount: sql`${universityCommunityPosts.reactionCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(universityCommunityPosts.id, targetId));
      }
    });
    const counts = await communityReactionCounts(targetType, [targetId]);
    return { reactionCount: counts.get(targetId) ?? 0, youReacted: true };
  }

  /**
   * Remove a reaction. Deletes the row (reactions are the one place we delete —
   * a withdrawn reaction carries no audit value). Decrements the post counter
   * only when a row was actually deleted. Returns the current count +
   * youReacted:false.
   */
  async function unreactToCommunity(
    accountId: string,
    targetType: "post" | "comment",
    targetId: string,
    emoji: string,
  ): Promise<{ reactionCount: number; youReacted: boolean }> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(universityCommunityReactions)
        .where(
          and(
            sql`LOWER(${universityCommunityReactions.reactorEmail}) = ${identity.email}`,
            eq(universityCommunityReactions.targetType, targetType),
            eq(universityCommunityReactions.targetId, targetId),
            eq(universityCommunityReactions.emoji, emoji),
          ),
        )
        .returning({ id: universityCommunityReactions.id });
      if (deleted.length > 0 && targetType === "post") {
        await tx
          .update(universityCommunityPosts)
          .set({
            reactionCount: sql`GREATEST(${universityCommunityPosts.reactionCount} - 1, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(universityCommunityPosts.id, targetId));
      }
    });
    const counts = await communityReactionCounts(targetType, [targetId]);
    return { reactionCount: counts.get(targetId) ?? 0, youReacted: false };
  }

  /**
   * Report a post/comment. Idempotent on (reporter, target) — a re-report is a
   * no-op, never report-spam. After recording, if the target's OPEN-report
   * count reaches the auto-hide threshold, flip it to status='hidden',
   * hidden_reason='report' (reversible). Never reveals report counts to members.
   */
  async function reportCommunityTarget(
    accountId: string,
    targetType: "post" | "comment",
    targetId: string,
    reasonRaw: string | null,
  ): Promise<void> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) throw new Error("Account not found");
    if (!(await communityTargetIsVisible(targetType, targetId))) {
      throw new CommunityError(404, "Target not found");
    }
    const reason =
      reasonRaw && reasonRaw.trim().length
        ? reasonRaw.trim().slice(0, COMMUNITY_REPORT_REASON_MAX)
        : null;

    await db
      .insert(universityCommunityReports)
      .values({
        reporterEmail: identity.email,
        accountId: identity.accountId,
        targetType,
        targetId,
        reason,
      })
      .onConflictDoNothing({
        target: [
          universityCommunityReports.reporterEmail,
          universityCommunityReports.targetType,
          universityCommunityReports.targetId,
        ],
      });

    const [{ openCount }] = await db
      .select({ openCount: sql<number>`count(*)::int` })
      .from(universityCommunityReports)
      .where(
        and(
          eq(universityCommunityReports.targetType, targetType),
          eq(universityCommunityReports.targetId, targetId),
          eq(universityCommunityReports.status, "open"),
        ),
      );

    if (Number(openCount) >= autoHideThreshold()) {
      if (targetType === "post") {
        await db
          .update(universityCommunityPosts)
          .set({
            status: "hidden",
            hiddenReason: "report",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(universityCommunityPosts.id, targetId),
              eq(universityCommunityPosts.status, "visible"),
            ),
          );
      } else {
        await db
          .update(universityCommunityComments)
          .set({
            status: "hidden",
            hiddenReason: "report",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(universityCommunityComments.id, targetId),
              eq(universityCommunityComments.status, "visible"),
            ),
          );
      }
    }
  }

  /**
   * Count of the member's UNREAD community notifications (replies to them).
   * Drives the sidebar badge. Cheap — rides the (recipient_email, read_at) index.
   */
  async function getCommunityUnreadCount(accountId: string): Promise<number> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) return 0;
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(universityCommunityNotifications)
      .where(
        and(
          sql`LOWER(${universityCommunityNotifications.recipientEmail}) = ${identity.email}`,
          isNull(universityCommunityNotifications.readAt),
        ),
      );
    return Number(c);
  }

  /**
   * Mark all of the member's unread community notifications as seen (read_at =
   * now). Idempotent; returns the number marked.
   */
  async function markCommunityNotificationsSeen(
    accountId: string,
  ): Promise<number> {
    const identity = await resolveProgressIdentity(accountId);
    if (!identity) return 0;
    const updated = await db
      .update(universityCommunityNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          sql`LOWER(${universityCommunityNotifications.recipientEmail}) = ${identity.email}`,
          isNull(universityCommunityNotifications.readAt),
        ),
      )
      .returning({ id: universityCommunityNotifications.id });
    return updated.length;
  }

  // Fire the reply email via the lifecycle envelope. The storefront template
  // for `university_community_reply` shipped 2026-07-01 (landing `1441d7a`).
  // sendCreditscoreEmail still warn-and-continues (it no-ops when the callback
  // isn't configured), so the in-app badge works even without it.
  async function sendCommunityReplyEmail(args: {
    recipientEmail: string;
    postId: string;
    snippet: string;
  }): Promise<void> {
    try {
      const base = portalBaseUrl().replace(/\/+$/, "");
      await sendCreditscoreEmail({
        kind: "university_community_reply",
        to: args.recipientEmail,
        data: {
          postUrl: `${base}/university/community/${args.postId}`,
          snippet: args.snippet,
        },
      });
    } catch (err) {
      logger.error(
        { err, recipientEmail: args.recipientEmail, postId: args.postId },
        "portal/university/community: reply email send failed",
      );
    }
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
    getUniversityStripeSubscriptionId,
    recordCancelFeedback,
    setStripeCustomerId,
    recordRep,
    recordCheckin,
    getProgressSummary,
    computeStreak,
    recordTrainingScore,
    upsertNote,
    getNotes,
    deleteNote,
    setNoteEnrichment,
    setNoteEmbedding,
    getRelatedNotes,
    getCommunityFeed,
    createCommunityPost,
    getCommunityPost,
    deleteCommunityPost,
    createCommunityComment,
    deleteCommunityComment,
    acceptCommunityAnswer,
    unacceptCommunityAnswer,
    supportIdea,
    unsupportIdea,
    listIdeaSupporters,
    reactToCommunity,
    unreactToCommunity,
    reportCommunityTarget,
    getCommunityUnreadCount,
    markCommunityNotificationsSeen,
    logAction,
  };
}

export type CustomerPortalService = ReturnType<typeof customerPortalService>;
