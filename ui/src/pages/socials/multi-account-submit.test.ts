import { describe, expect, it } from "vitest";
import { submitToAccounts } from "./multi-account-submit";

describe("submitToAccounts", () => {
  it("creates one post per selected account", async () => {
    const calledWith: string[] = [];
    const results = await submitToAccounts(["a1", "a2", "a3"], async (id) => {
      calledWith.push(id);
      return { id, ok: true };
    });

    expect(calledWith).toEqual(["a1", "a2", "a3"]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("isolates a failed account — the others still succeed", async () => {
    const results = await submitToAccounts(["good1", "bad", "good2"], async (id) => {
      if (id === "bad") throw new Error("account not connected");
      return { id };
    });

    expect(results).toHaveLength(3);
    const byId = new Map(results.map((r) => [r.accountId, r]));

    expect(byId.get("good1")).toMatchObject({ ok: true });
    expect(byId.get("good2")).toMatchObject({ ok: true });
    const bad = byId.get("bad");
    expect(bad?.ok).toBe(false);
    if (!bad?.ok) expect(bad?.error).toBe("account not connected");
  });

  it("preserves per-account result order matching the input ids", async () => {
    const results = await submitToAccounts(["x", "y"], async (id) =>
      id === "x" ? Promise.resolve("first") : Promise.resolve("second"),
    );
    expect(results.map((r) => r.accountId)).toEqual(["x", "y"]);
  });

  it("stringifies non-Error rejections instead of throwing", async () => {
    const results = await submitToAccounts(["one"], async () => {
      throw "plain string rejection";
    });
    expect(results[0]).toMatchObject({ accountId: "one", ok: false, error: "plain string rejection" });
  });

  it("returns an empty array for an empty id list", async () => {
    const results = await submitToAccounts([], async () => "unused");
    expect(results).toEqual([]);
  });
});
