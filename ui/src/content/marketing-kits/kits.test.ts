// Validates the committed kit module (synced by `pnpm kits:sync`) against the
// CONTRACT-2 expectations the Content Hub UI depends on. Pure data — node env.
import { describe, expect, it } from "vitest";
import { KITS, KIT_SYNC_META } from "./index";
import type { MarketingKit } from "./types";

const byId = new Map<number, MarketingKit>(KITS.map((kit) => [kit.id, kit]));

describe("marketing-kits committed data", () => {
  it("contains all 10 kits, ids 0-9, sorted", () => {
    expect(KITS).toHaveLength(10);
    expect(KITS.map((kit) => kit.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("every kit satisfies the basic shape", () => {
    for (const kit of KITS) {
      expect(kit.title.length).toBeGreaterThan(0);
      expect(["endcard-pack", "funnel"]).toContain(kit.kind);
      expect(kit.raw.length).toBeGreaterThan(50);
      expect(Array.isArray(kit.fields)).toBe(true);
      expect(Array.isArray(kit.spokenLines)).toBe(true);
      for (const line of kit.spokenLines) {
        expect(line.text.length).toBeGreaterThan(0);
        expect(line.voiceKey.length).toBeGreaterThan(0);
      }
    }
  });

  it("KIT 0 is the end-card pack with 5 spoken say-lines", () => {
    const kit0 = byId.get(0)!;
    expect(kit0.kind).toBe("endcard-pack");
    expect(kit0.spokenLines).toHaveLength(5);
    expect(kit0.spokenLines.every((line) => line.voiceKey === "mark")).toBe(true);
    // One field per on-screen end card.
    expect(kit0.fields).toHaveLength(5);
  });

  it("KIT 1 surfaces BOTH clickTag values (doc says ig-room, live automation uses room)", () => {
    const kit1 = byId.get(1)!;
    expect(kit1.clickTags).toContain("ig-room");
    expect(kit1.clickTags).toContain("room");
    expect(kit1.keyword).toBe("ROOM");
  });

  it("KIT 3 has no spoken snippet (tolerated) and never leaks {link} into spoken lines", () => {
    expect(byId.get(3)!.spokenLines).toHaveLength(0);
    for (const kit of KITS) {
      for (const line of kit.spokenLines) {
        expect(line.text).not.toContain("{link}");
      }
    }
  });

  it("raw blocks are md-sourced — no HTML entities from the board file", () => {
    for (const kit of KITS) {
      expect(kit.raw).not.toMatch(/&(amp|lt|gt|quot|#\d+);/);
    }
  });

  it("UTF-8 fidelity survives the sync (emoji, accents, Spanish/Chinese)", () => {
    expect(byId.get(0)!.raw).toContain("🟢");
    expect(byId.get(7)!.raw).toContain("CACHÉ");
    expect(byId.get(7)!.raw).toContain("💋");
    expect(byId.get(7)!.spokenLines[0]!.text).toContain("dólares");
    expect(byId.get(9)!.raw).toContain("真的");
  });

  it("voice routing: Mark reads brand kits, personas read theirs", () => {
    for (const id of [0, 1, 2, 3, 4, 5]) expect(byId.get(id)!.voiceKey).toBe("mark");
    expect(byId.get(6)!.voiceKey).toBe("brianna");
    expect(byId.get(7)!.voiceKey).toBe("mami");
    expect(byId.get(8)!.voiceKey).toBe("solene");
    expect(byId.get(9)!.voiceKey).toBe("remy");
  });

  it("sync meta is present and plausible", () => {
    expect(KIT_SYNC_META.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(KIT_SYNC_META.sourcePath.endsWith(".md")).toBe(true);
    expect(Number.isNaN(Date.parse(KIT_SYNC_META.syncedAt))).toBe(false);
  });
});
