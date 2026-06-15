import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { randomBytes, randomUUID, scryptSync, createHash } from "node:crypto";
import QRCode from "qrcode";
import type { Db } from "@paperclipai/db";
import {
  affiliates,
  shopReferralEvents,
  shopSharers,
} from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Shop sharers service — email capture → referral code + QR + share link,
// with opt-in promotion to the existing affiliate program.
// See docs/products/shop-sharers.md.
// ---------------------------------------------------------------------------

export const SHOP_SHARE_BASE_URL =
  process.env.SHOP_SHARE_BASE_URL ?? "https://shop.coherencedaddy.com";

// Readable short code (6 chars, lowercase alphanumerics minus ambiguous chars).
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generateCode(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

// Normalize an admin-supplied vanity code (e.g. "Remy" → "remy") into a
// URL-safe slug. Lowercases, collapses runs of non-alphanumerics to a single
// hyphen, trims stray hyphens, and caps length. Returns "" if nothing usable
// remains so the caller can fall back to a random code or reject.
export function slugifyReferralCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function shareUrlFor(code: string): string {
  return `${SHOP_SHARE_BASE_URL}/?ref=${encodeURIComponent(code)}`;
}

export function shopSharersService(db: Db) {
  async function mintUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = generateCode();
      const existing = await db
        .select({ id: shopSharers.id })
        .from(shopSharers)
        .where(eq(shopSharers.referralCode, code))
        .limit(1);
      if (existing.length === 0) return code;
    }
    // Extremely unlikely: fall back to a uuid prefix.
    return randomUUID().replace(/-/g, "").slice(0, 10);
  }

  async function getByEmail(email: string) {
    const rows = await db
      .select()
      .from(shopSharers)
      .where(ilike(shopSharers.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getByCode(code: string) {
    const rows = await db
      .select()
      .from(shopSharers)
      .where(eq(shopSharers.referralCode, code))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getById(id: string) {
    const rows = await db
      .select()
      .from(shopSharers)
      .where(eq(shopSharers.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  // Idempotent: if the email already exists, return the existing row.
  // Returns { row, created } so callers can trigger welcome-email only on new rows.
  async function upsertByEmail(input: { email: string; source?: string }) {
    const normalized = input.email.trim().toLowerCase();
    const existing = await getByEmail(normalized);
    if (existing) return { row: existing, created: false };

    const referralCode = await mintUniqueCode();
    const [row] = await db
      .insert(shopSharers)
      .values({
        email: normalized,
        referralCode,
        source: input.source ?? "shop_hero",
      })
      .returning();
    return { row: row!, created: true };
  }

  // Admin-initiated creation (source defaults to 'admin'). Used to mint a
  // tracking link for a named affiliate/influencer straight from the dashboard
  // — no shop email-capture, no discount, just a referral link. Idempotent by
  // email: re-adding an existing sharer returns the existing row untouched.
  // An optional vanity `referralCode` lets the link read `?ref=remy`; if it is
  // already taken (or omitted) we fall back accordingly.
  async function createForAdmin(input: {
    email: string;
    referralCode?: string;
    source?: string;
  }): Promise<{ row: typeof shopSharers.$inferSelect; created: boolean }> {
    const normalized = input.email.trim().toLowerCase();
    const existing = await getByEmail(normalized);
    if (existing) return { row: existing, created: false };

    let code: string;
    const requested =
      typeof input.referralCode === "string" ? input.referralCode.trim() : "";
    if (requested) {
      code = slugifyReferralCode(requested);
      if (!code) {
        throw new Error(
          "referralCode must contain at least one letter or number",
        );
      }
      const taken = await getByCode(code);
      if (taken) {
        throw new Error(`Referral code "${code}" is already in use`);
      }
    } else {
      code = await mintUniqueCode();
    }

    const [row] = await db
      .insert(shopSharers)
      .values({
        email: normalized,
        referralCode: code,
        source: input.source ?? "admin",
      })
      .returning();
    return { row: row!, created: true };
  }

  async function applyAffiliate(code: string) {
    const [row] = await db
      .update(shopSharers)
      .set({
        affiliateApplicationStatus: "pending",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(shopSharers.referralCode, code),
          // Do not overwrite approved/rejected rows with 'pending'.
          sql`(${shopSharers.affiliateApplicationStatus} IS NULL OR ${shopSharers.affiliateApplicationStatus} = 'pending')`,
        ),
      )
      .returning();
    return row ?? null;
  }

  async function approve(
    sharerId: string,
    opts: { displayName?: string } = {},
  ) {
    const sharer = await getById(sharerId);
    if (!sharer) return null;
    if (sharer.affiliateId) {
      // Already promoted — refresh flags and return.
      return sharer;
    }

    // Create an affiliate row mirroring routes/affiliates.ts:178. The sharer
    // has no password yet — set a random one + a reset token so the approval
    // email can route them to a password-set flow.
    const placeholderPassword = randomBytes(24).toString("hex");
    const passwordHash = hashPassword(placeholderPassword);
    const resetToken = randomBytes(24).toString("hex");
    const resetTokenHash = createHash("sha256").update(resetToken).digest("hex");

    const [affiliate] = await db
      .insert(affiliates)
      .values({
        email: sharer.email,
        passwordHash,
        name: opts.displayName ?? sharer.email.split("@")[0] ?? "Sharer",
        status: "active",
        resetToken: resetTokenHash,
        resetTokenExpiresAt: sql`now() + interval '14 days'`,
      })
      .returning();

    const [updated] = await db
      .update(shopSharers)
      .set({
        affiliateApplicationStatus: "approved",
        affiliateId: affiliate!.id,
        sharedMarketingEligible: true,
        updatedAt: sql`now()`,
      })
      .where(eq(shopSharers.id, sharerId))
      .returning();

    return { sharer: updated!, affiliate: affiliate!, resetToken };
  }

  async function reject(sharerId: string, notes?: string) {
    const [row] = await db
      .update(shopSharers)
      .set({
        affiliateApplicationStatus: "rejected",
        sharedMarketingEligible: false,
        notes: notes ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(shopSharers.id, sharerId))
      .returning();
    return row ?? null;
  }

  async function listForAdmin(status?: string) {
    if (status) {
      return db
        .select()
        .from(shopSharers)
        .where(eq(shopSharers.affiliateApplicationStatus, status))
        .orderBy(desc(shopSharers.createdAt));
    }
    return db.select().from(shopSharers).orderBy(desc(shopSharers.createdAt));
  }

  async function recordHit(input: {
    code: string;
    path?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    userAgent?: string;
    ipHash?: string;
  }) {
    const sharer = await getByCode(input.code);
    if (!sharer) return null;
    const [row] = await db
      .insert(shopReferralEvents)
      .values({
        sharerId: sharer.id,
        referralCode: input.code,
        eventType: "hit",
        path: input.path ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        referrer: input.referrer ?? null,
        userAgent: input.userAgent ?? null,
        ipHash: input.ipHash ?? null,
      })
      .returning();
    return row ?? null;
  }

  async function renderQrPng(code: string, width = 512): Promise<Buffer> {
    return QRCode.toBuffer(shareUrlFor(code), {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width,
      color: { dark: "#111111", light: "#ffffff" },
    });
  }

  return {
    upsertByEmail,
    createForAdmin,
    getByEmail,
    getByCode,
    getById,
    applyAffiliate,
    approve,
    reject,
    listForAdmin,
    recordHit,
    renderQrPng,
  };
}
