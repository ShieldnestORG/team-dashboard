// ---------------------------------------------------------------------------
// Coherent Ones University — ad/marketing attribution upsert (M2 checkout side).
//
// One attribution row PER lead, keyed on the lowercased `email` (the same
// durable identity the rest of University uses — see schema/university.ts and
// the 0127_university_attribution.sql migration).
//
// `upsertAttribution` is called at checkout creation (routes/university-checkout
// .ts) with the click ids / UTM params / landing context that arrived on the
// storefront payload. It upserts ON CONFLICT (email):
//   - `first_touch_at` is stamped on the FIRST insert and is IMMUTABLE
//     thereafter (COALESCE keeps the existing value).
//   - `last_touch_at` refreshes on every touch.
//   - click ids / UTM params / landing context are FILLED IN when newly
//     present and otherwise left as-is (COALESCE(existing, new) — never
//     clobbered back to NULL by a later touch that lacks them).
//
// The Stripe customer + subscription ids are NOT set here — those are stamped
// later by the webhook side (it knows the resolved customer/subscription). This
// checkout-side upsert is purely the click-context capture.
//
// Mirrors the Drizzle onConflictDoUpdate style used in services/customer-portal
// .ts (universityProgress) and the upsert discipline in
// services/university-stripe-handler.ts.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { universityAttribution } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

/**
 * The ad-attribution fields captured from a checkout payload. Every field is
 * optional — a checkout with no attribution still upserts a touch row keyed on
 * email (first/last touch timestamps), which is harmless and keeps the lead's
 * identity present for later webhook stamping.
 */
export interface AttributionInput {
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  ttclid?: string;
  gclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingUrl?: string;
  referrer?: string;
}

/**
 * Upsert the per-lead attribution row keyed on the lowercased `email`.
 *
 * Non-fatal by contract: never throws into the caller. Attribution is a
 * best-effort marketing signal — a failure to record it must NOT break the
 * checkout flow. On error it logs and returns false.
 *
 * @returns true if the upsert ran, false if it was skipped/failed.
 */
export async function upsertAttribution(
  db: Db,
  email: string,
  input: AttributionInput,
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const now = new Date();

  // Normalize empty strings to null so COALESCE keeps a previously-captured
  // value instead of overwriting it with "".
  const v = (s: string | undefined): string | null => {
    const t = s?.trim();
    return t ? t : null;
  };

  const fields = {
    fbclid: v(input.fbclid),
    fbc: v(input.fbc),
    fbp: v(input.fbp),
    ttclid: v(input.ttclid),
    gclid: v(input.gclid),
    utmSource: v(input.utmSource),
    utmMedium: v(input.utmMedium),
    utmCampaign: v(input.utmCampaign),
    utmContent: v(input.utmContent),
    utmTerm: v(input.utmTerm),
    landingUrl: v(input.landingUrl),
    referrer: v(input.referrer),
  };

  try {
    await db
      .insert(universityAttribution)
      .values({
        email: normalizedEmail,
        ...fields,
        firstTouchAt: now,
        lastTouchAt: now,
      })
      .onConflictDoUpdate({
        target: universityAttribution.email,
        set: {
          // First-touch is IMMUTABLE: keep the originally-stamped value
          // (COALESCE against the new now() only matters for legacy NULL rows).
          firstTouchAt: sql`COALESCE(${universityAttribution.firstTouchAt}, ${now})`,
          // Last-touch always refreshes.
          lastTouchAt: now,
          // Click ids / UTM / landing context: fill in when newly present,
          // never clobber an existing value back to NULL (COALESCE keeps the
          // existing column value, falling back to the freshly-bound one).
          fbclid: sql`COALESCE(${universityAttribution.fbclid}, ${fields.fbclid})`,
          fbc: sql`COALESCE(${universityAttribution.fbc}, ${fields.fbc})`,
          fbp: sql`COALESCE(${universityAttribution.fbp}, ${fields.fbp})`,
          ttclid: sql`COALESCE(${universityAttribution.ttclid}, ${fields.ttclid})`,
          gclid: sql`COALESCE(${universityAttribution.gclid}, ${fields.gclid})`,
          utmSource: sql`COALESCE(${universityAttribution.utmSource}, ${fields.utmSource})`,
          utmMedium: sql`COALESCE(${universityAttribution.utmMedium}, ${fields.utmMedium})`,
          utmCampaign: sql`COALESCE(${universityAttribution.utmCampaign}, ${fields.utmCampaign})`,
          utmContent: sql`COALESCE(${universityAttribution.utmContent}, ${fields.utmContent})`,
          utmTerm: sql`COALESCE(${universityAttribution.utmTerm}, ${fields.utmTerm})`,
          landingUrl: sql`COALESCE(${universityAttribution.landingUrl}, ${fields.landingUrl})`,
          referrer: sql`COALESCE(${universityAttribution.referrer}, ${fields.referrer})`,
          updatedAt: now,
        },
      });
    return true;
  } catch (err) {
    logger.error(
      { err, email: normalizedEmail },
      "university-attribution: upsert failed (non-fatal) — checkout continues without attribution row",
    );
    return false;
  }
}
