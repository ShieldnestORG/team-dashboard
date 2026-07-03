import { describe, expect, it } from "vitest";
import {
  parseFunnelDrafts,
  canApprove,
  canReject,
  canArm,
  canRetire,
  mapCatalogStatus,
  catalogAccountHandle,
  catalogKeywords,
} from "../services/socials/funnels-service.js";

// ---------------------------------------------------------------------------
// parseFunnelDrafts — defensive LLM-output parser. Must never throw; garbage
// in -> [] out; a partially-malformed array still yields the valid entries.
// ---------------------------------------------------------------------------

describe("parseFunnelDrafts", () => {
  it("returns [] for empty/garbage input without throwing", () => {
    expect(parseFunnelDrafts("")).toEqual([]);
    expect(parseFunnelDrafts("sorry, I can't help with that")).toEqual([]);
    expect(parseFunnelDrafts("<html>not json</html>")).toEqual([]);
  });

  it("returns [] for truncated/invalid JSON inside brackets", () => {
    expect(parseFunnelDrafts('[{"name": "broken", "keywords": [')).toEqual([]);
  });

  it("returns [] when the JSON parses but isn't an array", () => {
    expect(parseFunnelDrafts('{"name": "not an array"}')).toEqual([]);
  });

  it("parses a well-formed draft array", () => {
    const raw = JSON.stringify([
      {
        name: "COHERENT — Two-Step",
        keywords: ["coherent"],
        dm_message: "Hey! Reply YES and I'll send the link.",
        destination_url: "coherencedaddy.com/tools/coherence-engine",
        post_hooks: ["Comment COHERENT for the free check.", "hook 2", "hook 3"],
        style: "standard",
        tos_risk: "low",
        notes: "Headline funnel angle.",
      },
    ]);
    const drafts = parseFunnelDrafts(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      name: "COHERENT — Two-Step",
      keywords: ["COHERENT"],
      dmMessage: "Hey! Reply YES and I'll send the link.",
      destinationUrl: "coherencedaddy.com/tools/coherence-engine",
      style: "standard",
      tosRisk: "low",
    });
    expect(drafts[0]!.postHooks).toHaveLength(3);
  });

  it("strips markdown code fences around the JSON array", () => {
    const raw =
      '```json\n[{"name":"Fenced","keywords":["FENCE"],"dm_message":"hi","style":"weird","tos_risk":"low"}]\n```';
    const drafts = parseFunnelDrafts(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.name).toBe("Fenced");
  });

  it("drops entries with no keyword (fire-on-any-comment is a ToS hazard)", () => {
    const raw = JSON.stringify([
      { name: "No keyword", keywords: [], dm_message: "hi", style: "standard", tos_risk: "low" },
    ]);
    expect(parseFunnelDrafts(raw)).toEqual([]);
  });

  it("drops entries with an empty dm_message", () => {
    const raw = JSON.stringify([{ name: "No DM", keywords: ["X"], dm_message: "", style: "standard" }]);
    expect(parseFunnelDrafts(raw)).toEqual([]);
  });

  it("drops entries with a name that is too short", () => {
    const raw = JSON.stringify([{ name: "Hi", keywords: ["X"], dm_message: "hi there" }]);
    expect(parseFunnelDrafts(raw)).toEqual([]);
  });

  it("keeps valid entries even when a sibling entry in the same array is malformed", () => {
    const raw = JSON.stringify([
      { name: "Valid one", keywords: ["OK"], dm_message: "hi there", style: "standard", tos_risk: "low" },
      { name: "", keywords: [], dm_message: "" }, // invalid — dropped
      "just a string", // invalid — dropped
      null, // invalid — dropped
      { name: "Valid two", keywords: ["OK2"], dm_message: "hi again", style: "weird", tos_risk: "medium" },
    ]);
    const drafts = parseFunnelDrafts(raw);
    expect(drafts.map((d) => d.name)).toEqual(["Valid one", "Valid two"]);
  });

  it("defaults an unrecognized style to 'standard' rather than dropping the entry", () => {
    const raw = JSON.stringify([{ name: "Weird style", keywords: ["X"], dm_message: "hi", style: "spicy" }]);
    const drafts = parseFunnelDrafts(raw);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.style).toBe("standard");
  });

  it("defaults an unrecognized/missing tos_risk to 'medium', never inventing 'low'", () => {
    const raw = JSON.stringify([{ name: "No risk stated", keywords: ["X"], dm_message: "hi" }]);
    const drafts = parseFunnelDrafts(raw);
    expect(drafts[0]!.tosRisk).toBe("medium");
  });

  it("caps keywords at 2 and post_hooks at 3", () => {
    const raw = JSON.stringify([
      {
        name: "Too many fields",
        keywords: ["ONE", "TWO", "THREE", "FOUR"],
        dm_message: "hi",
        post_hooks: ["a", "b", "c", "d", "e"],
      },
    ]);
    const drafts = parseFunnelDrafts(raw);
    expect(drafts[0]!.keywords).toHaveLength(2);
    expect(drafts[0]!.postHooks).toHaveLength(3);
  });

  it("clamps an oversized dm_message to 640 chars (Zernio button_template limit)", () => {
    const raw = JSON.stringify([{ name: "Long DM", keywords: ["X"], dm_message: "y".repeat(1000) }]);
    const drafts = parseFunnelDrafts(raw);
    expect(drafts[0]!.dmMessage).toHaveLength(640);
  });
});

// ---------------------------------------------------------------------------
// Status-transition guards
// ---------------------------------------------------------------------------

describe("canApprove", () => {
  it("allows draft -> ready", () => {
    expect(canApprove("draft")).toBe(true);
  });
  it("rejects every other status", () => {
    expect(canApprove("ready")).toBe(false);
    expect(canApprove("live")).toBe(false);
    expect(canApprove("rejected")).toBe(false);
    expect(canApprove("retired")).toBe(false);
  });
});

describe("canReject", () => {
  it("allows draft or ready -> rejected", () => {
    expect(canReject("draft")).toBe(true);
    expect(canReject("ready")).toBe(true);
  });
  it("rejects live/rejected/retired", () => {
    expect(canReject("live")).toBe(false);
    expect(canReject("rejected")).toBe(false);
    expect(canReject("retired")).toBe(false);
  });
});

describe("canArm", () => {
  it("allows ready + funnelsEnabled + dmMessage + keywords -> live", () => {
    expect(canArm("ready", true, "hey! click below", ["ROOM"])).toEqual({ ok: true });
  });
  it("blocks a non-ready status with a plain-English error", () => {
    const result = canArm("draft", true, "hey!", ["ROOM"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must be 'ready'/);
  });
  it("blocks arming when the account's funnels gate is off", () => {
    const result = canArm("ready", false, "hey!", ["ROOM"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/funnels are disabled/);
  });
  it("blocks arming when dmMessage is empty", () => {
    const result = canArm("ready", true, "   ", ["ROOM"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/DM message/);
  });
  it("blocks arming when there is no non-empty keyword", () => {
    const result = canArm("ready", true, "hey!", []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/keyword/);

    const resultBlank = canArm("ready", true, "hey!", ["  "]);
    expect(resultBlank.ok).toBe(false);
  });
});

describe("canRetire", () => {
  it("allows ready or live -> retired", () => {
    expect(canRetire("ready")).toBe(true);
    expect(canRetire("live")).toBe(true);
  });
  it("rejects draft/rejected/retired", () => {
    expect(canRetire("draft")).toBe(false);
    expect(canRetire("rejected")).toBe(false);
    expect(canRetire("retired")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Catalog-import mapping helpers
// ---------------------------------------------------------------------------

describe("mapCatalogStatus", () => {
  it("maps live -> live", () => {
    expect(mapCatalogStatus("live")).toEqual({ status: "live" });
  });
  it("maps ready/built -> ready", () => {
    expect(mapCatalogStatus("ready")).toEqual({ status: "ready" });
    expect(mapCatalogStatus("built")).toEqual({ status: "ready" });
  });
  it("maps planned/idea -> draft", () => {
    expect(mapCatalogStatus("planned")).toEqual({ status: "draft" });
    expect(mapCatalogStatus("idea")).toEqual({ status: "draft" });
  });
  it("maps blocked-on-account -> draft with a note", () => {
    const result = mapCatalogStatus("blocked-on-account");
    expect(result.status).toBe("draft");
    expect(result.extraNote).toMatch(/Blocked on account/);
  });
  it("maps wont-build -> rejected", () => {
    expect(mapCatalogStatus("wont-build")).toEqual({ status: "rejected" });
  });
  it("defaults an unrecognized status to draft with a note (fail loud, not silent)", () => {
    const result = mapCatalogStatus("mystery-status");
    expect(result.status).toBe("draft");
    expect(result.extraNote).toMatch(/Unmapped catalog status/);
  });
});

describe("catalogAccountHandle", () => {
  it("returns the first @handle-shaped entry, stripped of @ and parenthetical suffix", () => {
    expect(catalogAccountHandle(["@coherencedaddy"])).toBe("coherencedaddy");
    expect(catalogAccountHandle(["@coherence_daddy (28k)"])).toBe("coherence_daddy");
  });
  it("falls back to multi-account when nothing looks like a handle", () => {
    expect(catalogAccountHandle(["all brand"])).toBe("multi-account");
    expect(catalogAccountHandle(["—"])).toBe("multi-account");
    expect(catalogAccountHandle(undefined)).toBe("multi-account");
  });
});

describe("catalogKeywords", () => {
  it("extracts quoted keywords from a trigger string", () => {
    expect(catalogKeywords('comment "COHERENT" (account-wide)')).toEqual(["COHERENT"]);
  });
  it("extracts multiple quoted variants", () => {
    expect(catalogKeywords('comment "CACHÉ" or "CACHE" (account-wide)')).toEqual(["CACHÉ", "CACHE"]);
  });
  it("returns [] when there is nothing quoted", () => {
    expect(catalogKeywords("operator-driven (comments/threads)")).toEqual([]);
    expect(catalogKeywords(undefined)).toEqual([]);
  });
});
