import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documents, documentRevisions } from "@paperclipai/db";

const STRUCTURE_TITLE = "company-structure";

export function structureService(db: Db) {
  return {
    getDiagram: async (companyId: string) => {
      const row = await db
        .select({
          id: documents.id,
          body: documents.latestBody,
          revisionNumber: documents.latestRevisionNumber,
          updatedAt: documents.updatedAt,
          updatedByAgentId: documents.updatedByAgentId,
        })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, companyId),
            eq(documents.title, STRUCTURE_TITLE),
          ),
        )
        .then((rows) => rows[0] ?? null);

      return row;
    },

    upsertDiagram: async (
      companyId: string,
      body: string,
      opts?: {
        agentId?: string;
        userId?: string;
        changeSummary?: string;
      },
    ) => {
      return db.transaction(async (tx) => {
        const now = new Date();
        const existing = await tx
          .select({
            id: documents.id,
            latestRevisionNumber: documents.latestRevisionNumber,
          })
          .from(documents)
          .where(
            and(
              eq(documents.companyId, companyId),
              eq(documents.title, STRUCTURE_TITLE),
            ),
          )
          .then((rows) => rows[0] ?? null);

        if (existing) {
          const nextRevision = existing.latestRevisionNumber + 1;
          const [revision] = await tx
            .insert(documentRevisions)
            .values({
              companyId,
              documentId: existing.id,
              revisionNumber: nextRevision,
              body,
              changeSummary: opts?.changeSummary ?? null,
              createdByAgentId: opts?.agentId ?? null,
              createdByUserId: opts?.userId ?? null,
              createdAt: now,
            })
            .returning();

          await tx
            .update(documents)
            .set({
              latestBody: body,
              latestRevisionId: revision.id,
              latestRevisionNumber: nextRevision,
              updatedByAgentId: opts?.agentId ?? null,
              updatedByUserId: opts?.userId ?? null,
              updatedAt: now,
            })
            .where(eq(documents.id, existing.id));

          return {
            id: existing.id,
            body,
            revisionNumber: nextRevision,
            updatedAt: now,
          };
        }

        // Create new document
        const [doc] = await tx
          .insert(documents)
          .values({
            companyId,
            title: STRUCTURE_TITLE,
            format: "mermaid",
            latestBody: body,
            latestRevisionId: null,
            latestRevisionNumber: 1,
            createdByAgentId: opts?.agentId ?? null,
            createdByUserId: opts?.userId ?? null,
            updatedByAgentId: opts?.agentId ?? null,
            updatedByUserId: opts?.userId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        const [revision] = await tx
          .insert(documentRevisions)
          .values({
            companyId,
            documentId: doc.id,
            revisionNumber: 1,
            body,
            changeSummary: opts?.changeSummary ?? "Initial structure diagram",
            createdByAgentId: opts?.agentId ?? null,
            createdByUserId: opts?.userId ?? null,
            createdAt: now,
          })
          .returning();

        await tx
          .update(documents)
          .set({ latestRevisionId: revision.id })
          .where(eq(documents.id, doc.id));

        return {
          id: doc.id,
          body,
          revisionNumber: 1,
          updatedAt: now,
        };
      });
    },

    getRevisions: async (companyId: string) => {
      const doc = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, companyId),
            eq(documents.title, STRUCTURE_TITLE),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!doc) return [];

      return db
        .select({
          id: documentRevisions.id,
          revisionNumber: documentRevisions.revisionNumber,
          changeSummary: documentRevisions.changeSummary,
          createdByAgentId: documentRevisions.createdByAgentId,
          createdByUserId: documentRevisions.createdByUserId,
          createdAt: documentRevisions.createdAt,
        })
        .from(documentRevisions)
        .where(eq(documentRevisions.documentId, doc.id))
        .orderBy(desc(documentRevisions.revisionNumber));
    },
  };
}
