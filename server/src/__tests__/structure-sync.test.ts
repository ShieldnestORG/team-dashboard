import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashDiagram,
  syncStructureDiagramFromRepo,
} from "../services/structure-sync.js";

type FakeDoc = { body: string; revisionNumber: number };

function makeFakeService(initial: FakeDoc | null) {
  const state = { doc: initial ? { ...initial } : null as FakeDoc | null };
  const getDiagram = vi.fn(async () => state.doc);
  const upsertDiagram = vi.fn(async (_company: string, body: string, _opts) => {
    const next = (state.doc?.revisionNumber ?? 0) + 1;
    state.doc = { body, revisionNumber: next };
    return { id: "doc-1", body, revisionNumber: next, updatedAt: new Date() };
  });
  return {
    svc: { getDiagram, upsertDiagram } as unknown as Parameters<
      typeof syncStructureDiagramFromRepo
    >[2]["svc"],
    state,
    getDiagram,
    upsertDiagram,
  };
}

const COMPANY_ID = "test-company";

describe("structure-sync", () => {
  const tmpFiles = new Set<string>();

  afterEach(async () => {
    for (const f of tmpFiles) await fs.rm(f, { force: true });
    tmpFiles.clear();
  });

  async function tempDiagram(body: string) {
    const file = path.join(os.tmpdir(), `structure-sync-${Date.now()}-${Math.random()}.mmd`);
    await fs.writeFile(file, body, "utf8");
    tmpFiles.add(file);
    return file;
  }

  it("hash is deterministic and a 16-hex-char short sha256", () => {
    expect(hashDiagram("hello")).toBe(hashDiagram("hello"));
    expect(hashDiagram("hello")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashDiagram("hello")).not.toBe(hashDiagram("world"));
  });

  it("returns missing-file when no diagram is provided or located", async () => {
    const fake = makeFakeService(null);
    const result = await syncStructureDiagramFromRepo({} as never, COMPANY_ID, {
      svc: fake.svc,
      diagramPath: null,
    });
    expect(result.status).toBe("missing-file");
    expect(fake.getDiagram).not.toHaveBeenCalled();
    expect(fake.upsertDiagram).not.toHaveBeenCalled();
  });

  it("creates a new revision when no document exists yet", async () => {
    const file = await tempDiagram("graph TB\nA-->B");
    const fake = makeFakeService(null);
    const result = await syncStructureDiagramFromRepo({} as never, COMPANY_ID, {
      svc: fake.svc,
      diagramPath: file,
    });
    expect(result.status).toBe("synced");
    expect(result.revisionNumber).toBe(1);
    expect(fake.upsertDiagram).toHaveBeenCalledTimes(1);
  });

  it("no-ops when persisted body matches the file", async () => {
    const body = "graph TB\nA-->B";
    const file = await tempDiagram(body);
    const fake = makeFakeService({ body, revisionNumber: 7 });
    const result = await syncStructureDiagramFromRepo({} as never, COMPANY_ID, {
      svc: fake.svc,
      diagramPath: file,
    });
    expect(result.status).toBe("unchanged");
    expect(result.revisionNumber).toBe(7);
    expect(fake.upsertDiagram).not.toHaveBeenCalled();
  });

  it("upserts a new revision when persisted body differs from the file", async () => {
    const oldBody = "graph TB\nA-->B";
    const newBody = "graph TB\nA-->B-->C";
    const file = await tempDiagram(newBody);
    const fake = makeFakeService({ body: oldBody, revisionNumber: 7 });
    const result = await syncStructureDiagramFromRepo({} as never, COMPANY_ID, {
      svc: fake.svc,
      diagramPath: file,
    });
    expect(result.status).toBe("synced");
    expect(result.revisionNumber).toBe(8);
    expect(fake.upsertDiagram).toHaveBeenCalledOnce();
    const [, bodyArg, opts] = fake.upsertDiagram.mock.calls[0];
    expect(bodyArg).toBe(newBody);
    expect(opts.changeSummary).toContain("auto-sync");
    expect(opts.changeSummary).toContain(hashDiagram(newBody));
  });
});
