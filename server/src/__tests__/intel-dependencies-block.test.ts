import { describe, expect, it } from "vitest";
import {
  bucketDependencyRows,
  DEPENDENCY_PER_BUCKET_CAP,
  DEPENDENCY_RELATIONSHIPS,
  type DependencyRow,
} from "../services/intel.ts";

function row(partial: Partial<DependencyRow> & Pick<DependencyRow, "relationship" | "target_id">): DependencyRow {
  return {
    relationship: partial.relationship,
    target_id: partial.target_id,
    target_type: partial.target_type ?? "company",
    confidence: partial.confidence ?? 0.9,
    scope: partial.scope ?? null,
    target_name: partial.target_name ?? null,
  };
}

describe("bucketDependencyRows", () => {
  it("returns empty object when no rows", () => {
    expect(bucketDependencyRows([])).toEqual({});
  });

  it("groups rows into the correct relationship buckets", () => {
    const out = bucketDependencyRows([
      row({ relationship: "uses", target_id: "vite" }),
      row({ relationship: "integrates", target_id: "stripe", target_name: "Stripe" }),
      row({ relationship: "depends_on", target_id: "react", scope: "runtime" }),
    ]);
    expect(out.uses).toEqual([{ slug: "vite", name: null, confidence: 0.9 }]);
    expect(out.integrates).toEqual([{ slug: "stripe", name: "Stripe", confidence: 0.9 }]);
    expect(out.depends_on).toEqual([
      { slug: "react", name: null, confidence: 0.9, scope: "runtime" },
    ]);
    expect(out.built_on).toBeUndefined();
    expect(out.maintains).toBeUndefined();
  });

  it("drops rows with relationships outside the allowed set", () => {
    const out = bucketDependencyRows([
      row({ relationship: "competes_with", target_id: "klue" }),
      row({ relationship: "uses", target_id: "vite" }),
    ]);
    expect(Object.keys(out)).toEqual(["uses"]);
  });

  it("caps each bucket at PER_BUCKET_CAP entries", () => {
    const rows: DependencyRow[] = [];
    for (let i = 0; i < DEPENDENCY_PER_BUCKET_CAP + 10; i++) {
      rows.push(row({ relationship: "depends_on", target_id: `pkg-${i}`, scope: "runtime" }));
    }
    const out = bucketDependencyRows(rows);
    expect((out.depends_on as unknown[]).length).toBe(DEPENDENCY_PER_BUCKET_CAP);
    expect((out.depends_on as Array<{ slug: string }>)[0].slug).toBe("pkg-0");
  });

  it("respects an explicit cap override", () => {
    const rows = [
      row({ relationship: "uses", target_id: "a" }),
      row({ relationship: "uses", target_id: "b" }),
      row({ relationship: "uses", target_id: "c" }),
    ];
    const out = bucketDependencyRows(rows, 2);
    expect((out.uses as unknown[]).length).toBe(2);
  });

  it("omits scope when null", () => {
    const out = bucketDependencyRows([row({ relationship: "uses", target_id: "vite" })]);
    expect((out.uses as Array<Record<string, unknown>>)[0]).not.toHaveProperty("scope");
  });

  it("includes scope when present (depends_on with runtime/devDependency)", () => {
    const out = bucketDependencyRows([
      row({ relationship: "depends_on", target_id: "vitest", scope: "devDependency" }),
    ]);
    expect((out.depends_on as Array<Record<string, unknown>>)[0]).toMatchObject({
      slug: "vitest",
      scope: "devDependency",
    });
  });

  it("preserves input ordering within a bucket", () => {
    const out = bucketDependencyRows([
      row({ relationship: "uses", target_id: "z", confidence: 0.99 }),
      row({ relationship: "uses", target_id: "a", confidence: 0.50 }),
    ]);
    expect((out.uses as Array<{ slug: string }>).map((e) => e.slug)).toEqual(["z", "a"]);
  });

  it("DEPENDENCY_RELATIONSHIPS contains the council-defined edge types", () => {
    expect([...DEPENDENCY_RELATIONSHIPS].sort()).toEqual([
      "built_on",
      "depends_on",
      "integrates",
      "maintains",
      "uses",
    ]);
  });
});
