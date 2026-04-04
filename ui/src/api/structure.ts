import { api } from "./client";

export interface StructureDiagram {
  id: string;
  body: string;
  revisionNumber: number;
  updatedAt: string;
  updatedByAgentId: string | null;
}

export interface StructureRevision {
  id: string;
  revisionNumber: number;
  changeSummary: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export const structureApi = {
  get: (companyId: string) =>
    api.get<{ diagram: StructureDiagram | null }>(
      `/companies/${companyId}/structure`,
    ),
  update: (companyId: string, body: string, changeSummary?: string) =>
    api.put<{ diagram: StructureDiagram }>(
      `/companies/${companyId}/structure`,
      { body, changeSummary },
    ),
  revisions: (companyId: string) =>
    api.get<{ revisions: StructureRevision[] }>(
      `/companies/${companyId}/structure/revisions`,
    ),
};
