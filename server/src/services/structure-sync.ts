import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Db } from "@paperclipai/db";
import { structureService } from "./structure.js";

const DEFAULT_COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
export const DIAGRAM_RELATIVE_PATH = "docs/architecture/company-structure.mmd";

export function locateDiagramFile(): string | null {
  const candidates = [
    resolve(process.cwd(), DIAGRAM_RELATIVE_PATH),
    resolve(process.cwd(), "..", DIAGRAM_RELATIVE_PATH),
    resolve("/app", DIAGRAM_RELATIVE_PATH),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function hashDiagram(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export interface SyncResult {
  status: "synced" | "unchanged" | "missing-file" | "error";
  revisionNumber?: number;
  bodyHash?: string;
  message?: string;
}

export interface SyncDeps {
  // Allow tests to inject a fake service or a custom diagram path.
  svc?: ReturnType<typeof structureService>;
  diagramPath?: string | null;
}

export async function syncStructureDiagramFromRepo(
  db: Db,
  companyId: string = process.env.TEAM_DASHBOARD_COMPANY_ID || DEFAULT_COMPANY_ID,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  const diagramPath = deps.diagramPath !== undefined ? deps.diagramPath : locateDiagramFile();
  if (!diagramPath) {
    return {
      status: "missing-file",
      message: `${DIAGRAM_RELATIVE_PATH} not found from cwd ${process.cwd()}`,
    };
  }

  const body = readFileSync(diagramPath, "utf8");
  const bodyHash = hashDiagram(body);
  const svc = deps.svc ?? structureService(db);
  const existing = await svc.getDiagram(companyId);

  if (existing && hashDiagram(existing.body ?? "") === bodyHash) {
    return {
      status: "unchanged",
      revisionNumber: existing.revisionNumber,
      bodyHash,
    };
  }

  const summary = `auto-sync from ${DIAGRAM_RELATIVE_PATH} (sha256:${bodyHash})`;
  const next = await svc.upsertDiagram(companyId, body, { changeSummary: summary });
  return {
    status: "synced",
    revisionNumber: next.revisionNumber,
    bodyHash,
  };
}
