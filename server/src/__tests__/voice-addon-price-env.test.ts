// ---------------------------------------------------------------------------
// Rex Voice add-on price ids come from env (VOICE_ADDON_PRICE_1HR /
// VOICE_ADDON_PRICE_2P5HR) so a Stripe account move needs no code change.
// Without the env vars the 2026-07-13 cutover-account ids stay the default.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";

async function loadHandler() {
  vi.resetModules();
  return import("../services/university-stripe-handler.js");
}

describe("voice add-on price ids", () => {
  afterEach(() => {
    delete process.env.VOICE_ADDON_PRICE_1HR;
    delete process.env.VOICE_ADDON_PRICE_2P5HR;
  });

  it("defaults to the cutover-account prices when env is unset", async () => {
    const h = await loadHandler();
    expect(h.VOICE_ADDON_TIERS["1hr"].priceId).toBe("price_1TseAAI4ork6rI44c6yhHEkn");
    expect(h.VOICE_ADDON_TIERS["2p5hr"].priceId).toBe("price_1TseAAI4ork6rI44sBsZgLJf");
  });

  it("uses the env price ids and maps them back to tiers", async () => {
    process.env.VOICE_ADDON_PRICE_1HR = " price_exegesis_1hr ";
    process.env.VOICE_ADDON_PRICE_2P5HR = "price_exegesis_2p5hr";
    const h = await loadHandler();
    expect(h.VOICE_ADDON_TIERS["1hr"].priceId).toBe("price_exegesis_1hr");
    expect(h.voiceAddonTierByPriceId("price_exegesis_2p5hr")).toBe("2p5hr");
    expect(h.voiceAddonTierByPriceId("price_1TseAAI4ork6rI44c6yhHEkn")).toBeNull();
    expect(h.invoiceLinesAreVoiceAddon([{ price: { id: "price_exegesis_1hr" } }])).toBe(true);
  });
});
