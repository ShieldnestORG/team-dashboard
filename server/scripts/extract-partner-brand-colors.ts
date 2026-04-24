/**
 * Extract Partner Brand Colors — 2026-04-24
 *
 * Downloads each partner's existing logoUrl, rasterizes if SVG, samples
 * pixels with sharp, and computes a primary / secondary / accent color
 * palette via a saturation-weighted histogram. Updates partnerCompanies
 * .brandColors. Skips partners that already have brandColors set unless
 * --force is passed.
 *
 * Usage:
 *   cd server && npx tsx scripts/extract-partner-brand-colors.ts [--force]
 */

import { eq, and, inArray } from "drizzle-orm";
import { partnerCompanies, createDb } from "@paperclipai/db";
import sharp from "sharp";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ??
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const SLUGS = [
  "sacred-wild",
  "artisan-metal-works",
  "tokns",
  "mark-joseph-jr-co",
  "house-of-exegesis",
  "exegesis-ventures",
  "get-probed",
];

const FORCE = process.argv.includes("--force");

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function fetchBuf(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "PaperclipPartnerEnrich/1.0" },
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface Palette {
  primary: string;
  secondary: string;
  accent: string;
}

async function extractPalette(imageBuf: Buffer): Promise<Palette | null> {
  // Rasterize (handles SVG, ICO, PNG, JPEG, etc.) at small size to make
  // pixel iteration cheap.
  let pixels: Buffer;
  try {
    const result = await sharp(imageBuf, { animated: false })
      .resize(64, 64, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer();
    pixels = result;
  } catch (err) {
    // ICO files sometimes need a hint. Try density boost for SVGs that
    // failed.
    try {
      const result = await sharp(imageBuf, { density: 300 })
        .resize(64, 64, { fit: "inside" })
        .removeAlpha()
        .raw()
        .toBuffer();
      pixels = result;
    } catch {
      throw err;
    }
  }

  // Bucket colors by quantized RGB; weight by saturation × value so we
  // ignore near-greyscale and near-black/white pixels.
  const buckets = new Map<string, { count: number; r: number; g: number; b: number; weight: number }>();
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const { s, v } = rgbToHsv(r, g, b);
    // Skip near-white, near-black, and grey
    if (v < 0.12 || v > 0.97) continue;
    if (s < 0.18) continue;
    const qr = r >> 4, qg = g >> 4, qb = b >> 4;
    const key = `${qr},${qg},${qb}`;
    const w = s * v;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, weight: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.weight += w;
    buckets.set(key, bucket);
  }

  if (buckets.size === 0) return null;

  // Sort buckets by total weight, then average within bucket.
  const ranked = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((bk) => ({
      r: Math.round(bk.r / bk.count),
      g: Math.round(bk.g / bk.count),
      b: Math.round(bk.b / bk.count),
    }));

  // Pick primary, then a secondary that is hue-distant from primary,
  // then an accent that is hue-distant from both.
  const hueDist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => {
    const ha = rgbToHsv(a.r, a.g, a.b).h;
    const hb = rgbToHsv(b.r, b.g, b.b).h;
    const d = Math.abs(ha - hb);
    return Math.min(d, 360 - d);
  };

  const primary = ranked[0];
  let secondary = ranked[1] ?? primary;
  for (const c of ranked.slice(1, 12)) {
    if (hueDist(primary, c) > 25) {
      secondary = c;
      break;
    }
  }
  let accent = ranked[2] ?? secondary;
  for (const c of ranked.slice(1, 20)) {
    if (hueDist(primary, c) > 25 && hueDist(secondary, c) > 25) {
      accent = c;
      break;
    }
  }

  return {
    primary: rgbToHex(primary.r, primary.g, primary.b),
    secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
    accent: rgbToHex(accent.r, accent.g, accent.b),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = createDb(process.env.DATABASE_URL);

  const rows = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        inArray(partnerCompanies.slug, SLUGS),
      ),
    );

  for (const partner of rows) {
    console.log(`\n=== ${partner.slug} ===`);
    if (!partner.logoUrl) {
      console.log("  skip — no logoUrl");
      continue;
    }
    if (partner.brandColors && !FORCE) {
      console.log(`  skip — brandColors already set: ${JSON.stringify(partner.brandColors)}`);
      continue;
    }
    console.log(`  logo: ${partner.logoUrl}`);

    let buf: Buffer;
    try {
      buf = await fetchBuf(partner.logoUrl);
    } catch (err) {
      console.error(`  ✗ fetch failed: ${(err as Error).message}`);
      continue;
    }

    let palette: Palette | null;
    try {
      palette = await extractPalette(buf);
    } catch (err) {
      console.error(`  ✗ extract failed: ${(err as Error).message}`);
      continue;
    }
    if (!palette) {
      console.log("  ✗ no saturated colors found (logo may be greyscale)");
      continue;
    }
    console.log(`  primary=${palette.primary} secondary=${palette.secondary} accent=${palette.accent}`);

    await db
      .update(partnerCompanies)
      .set({ brandColors: palette, updatedAt: new Date() })
      .where(eq(partnerCompanies.id, partner.id));
    console.log("  ✓ updated");
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
