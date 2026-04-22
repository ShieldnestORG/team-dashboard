import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, houseAds } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// House Ads service — admin-managed creatives + public slot lookup.
// ---------------------------------------------------------------------------

export interface HouseAdInput {
  title: string;
  imageAssetId: string;
  imageAlt?: string;
  clickUrl: string;
  slot: string;
  weight?: number;
  active?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export function houseAdsService(db: Db) {
  async function listAll(companyId: string) {
    return db
      .select()
      .from(houseAds)
      .where(eq(houseAds.companyId, companyId))
      .orderBy(desc(houseAds.createdAt));
  }

  async function getById(id: string) {
    const rows = await db
      .select()
      .from(houseAds)
      .where(eq(houseAds.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getAsset(assetId: string) {
    const rows = await db
      .select()
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function create(companyId: string, input: HouseAdInput) {
    const [row] = await db
      .insert(houseAds)
      .values({
        companyId,
        title: input.title,
        imageAssetId: input.imageAssetId,
        imageAlt: input.imageAlt ?? "",
        clickUrl: input.clickUrl,
        slot: input.slot,
        weight: input.weight ?? 1,
        active: input.active ?? true,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
      })
      .returning();
    return row;
  }

  async function update(id: string, patch: Partial<HouseAdInput>) {
    const [row] = await db
      .update(houseAds)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.imageAssetId !== undefined ? { imageAssetId: patch.imageAssetId } : {}),
        ...(patch.imageAlt !== undefined ? { imageAlt: patch.imageAlt } : {}),
        ...(patch.clickUrl !== undefined ? { clickUrl: patch.clickUrl } : {}),
        ...(patch.slot !== undefined ? { slot: patch.slot } : {}),
        ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
        ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(houseAds.id, id))
      .returning();
    return row ?? null;
  }

  async function remove(id: string) {
    const [row] = await db
      .delete(houseAds)
      .where(eq(houseAds.id, id))
      .returning();
    return row ?? null;
  }

  // Pick a single live ad for the given slot by weighted random.
  // Honours active flag + optional starts_at/ends_at window.
  async function pickForSlot(slot: string) {
    const now = new Date();
    const rows = await db
      .select()
      .from(houseAds)
      .where(
        and(
          eq(houseAds.slot, slot),
          eq(houseAds.active, true),
          or(isNull(houseAds.startsAt), lt(houseAds.startsAt, now)),
          or(isNull(houseAds.endsAt), gt(houseAds.endsAt, now)),
        ),
      );

    if (rows.length === 0) return null;

    // Weighted random selection.
    const totalWeight = rows.reduce((sum, r) => sum + Math.max(1, r.weight), 0);
    let pick = Math.random() * totalWeight;
    for (const row of rows) {
      pick -= Math.max(1, row.weight);
      if (pick <= 0) return row;
    }
    return rows[rows.length - 1];
  }

  async function recordImpression(id: string) {
    await db
      .update(houseAds)
      .set({ impressions: sql`${houseAds.impressions} + 1` })
      .where(eq(houseAds.id, id));
  }

  async function recordClick(id: string) {
    await db
      .update(houseAds)
      .set({ clicks: sql`${houseAds.clicks} + 1` })
      .where(eq(houseAds.id, id));
  }

  return {
    listAll,
    getById,
    getAsset,
    create,
    update,
    remove,
    pickForSlot,
    recordImpression,
    recordClick,
  };
}
