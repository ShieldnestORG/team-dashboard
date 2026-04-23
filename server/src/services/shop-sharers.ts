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
  async function upsertByEmail(input: { email: string; source?: string }) {
    const normalized = input.email.trim().toLowerCase();
    const existing = await getByEmail(normalized);
    if (existing) return existing;

    const referralCode = await mintUniqueCode();
    const [row] = await db
      .insert(shopSharers)
      .values({
        email: normalized,
        referralCode,
        source: input.source ?? "shop_hero",
      })
      .returning();
    return row!;
  }

  async function applyAffiliate(code: string) {
    const [row] = await db
      .update(shopSharers)
      .set({
        affiliateApplicationStatus: "pending",
        updatedAt: new Date(),
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
    const resetExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    const [affiliate] = await db
      .insert(affiliates)
      .values({
        email: sharer.email,
        passwordHash,
        name: opts.displayName ?? sharer.email.split("@")[0] ?? "Sharer",
        status: "active",
        resetToken: resetTokenHash,
        resetTokenExpiresAt: resetExpires,
      })
      .returning();

    const [updated] = await db
      .update(shopSharers)
      .set({
        affiliateApplicationStatus: "approved",
        affiliateId: affiliate!.id,
        sharedMarketingEligible: true,
        updatedAt: new Date(),
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
        updatedAt: new Date(),
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

  async function renderQrPng(code: string): Promise<Buffer> {
    return QRCode.toBuffer(shareUrlFor(code), {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#111111", light: "#ffffff" },
    });
  }

  return {
    upsertByEmail,
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
