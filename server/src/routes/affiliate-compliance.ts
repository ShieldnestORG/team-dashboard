// ---------------------------------------------------------------------------
// Affiliate compliance — admin routes
//
// Mounted under `/affiliates/admin` alongside `affiliateAdminRoutes`.
// Board-auth (assertBoard) on every route, matching the pattern in
// `server/src/routes/affiliates.ts`.
//
// Routes:
//   GET  /compliance/violations?affiliateId=&status=&severity=
//   POST /compliance/violations
//   PUT  /compliance/violations/:id/status
//   PUT  /admin/affiliates/:id/suspend
//
// Note on the suspend route: per the plan we can either wire the suspend
// route inside `affiliateAdminRoutes` OR export it standalone. We keep it
// standalone inside this file (same router) so the compliance feature is
// self-contained. It's mounted under `/affiliates/admin/admin/affiliates/:id/suspend`
// which is intentional — it preserves the plan's documented URL shape.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  affiliates,
  affiliateViolations,
  commissions,
  type AffiliateViolationEvidence,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { assertBoard } from "./authz.js";
import { HttpError } from "../errors.js";

type ViolationStatus = "open" | "acknowledged" | "overturned" | "enforced";
const VALID_VIOLATION_STATUSES: ViolationStatus[] = [
  "open",
  "acknowledged",
  "overturned",
  "enforced",
];

type Severity = "warning" | "strike" | "terminal";
const VALID_SEVERITIES: Severity[] = ["warning", "strike", "terminal"];

export function affiliateComplianceRoutes(db: Db): Router {
  const router = Router();

  // ── GET /compliance/violations ───────────────────────────────────────────
  router.get("/compliance/violations", async (req, res) => {
    try {
      assertBoard(req);

      const rawLimit = Number(req.query.limit);
      const rawOffset = Number(req.query.offset);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
          : 50;
      const offset =
        Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

      const affiliateIdFilter = req.query.affiliateId as string | undefined;
      const statusFilter = req.query.status as string | undefined;
      const severityFilter = req.query.severity as string | undefined;

      const conditions = [] as ReturnType<typeof eq>[];
      if (affiliateIdFilter) {
        conditions.push(eq(affiliateViolations.affiliateId, affiliateIdFilter));
      }
      if (statusFilter) {
        conditions.push(eq(affiliateViolations.status, statusFilter));
      }
      if (severityFilter) {
        conditions.push(eq(affiliateViolations.severity, severityFilter));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const baseQuery = db
        .select({
          id: affiliateViolations.id,
          affiliateId: affiliateViolations.affiliateId,
          affiliateName: affiliates.name,
          leadId: affiliateViolations.leadId,
          detectionType: affiliateViolations.detectionType,
          ruleCode: affiliateViolations.ruleCode,
          severity: affiliateViolations.severity,
          evidence: affiliateViolations.evidence,
          status: affiliateViolations.status,
          commissionsClawedBack: affiliateViolations.commissionsClawedBack,
          reviewedByUserId: affiliateViolations.reviewedByUserId,
          reviewedAt: affiliateViolations.reviewedAt,
          createdAt: affiliateViolations.createdAt,
        })
        .from(affiliateViolations)
        .leftJoin(affiliates, eq(affiliates.id, affiliateViolations.affiliateId));

      const listQuery = where ? baseQuery.where(where) : baseQuery;

      const countBase = db
        .select({ total: count() })
        .from(affiliateViolations);
      const countQuery = where ? countBase.where(where) : countBase;

      const [rows, totalRows] = await Promise.all([
        listQuery
          .orderBy(desc(affiliateViolations.createdAt))
          .limit(limit)
          .offset(offset),
        countQuery,
      ]);

      res.json({
        violations: rows,
        total: Number(totalRows[0]?.total ?? 0),
        limit,
        offset,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to list affiliate violations");
      res.status(500).json({ error: "Failed to list violations" });
    }
  });

  // ── POST /compliance/violations ──────────────────────────────────────────
  router.post("/compliance/violations", async (req, res) => {
    try {
      assertBoard(req);

      const body = req.body as {
        affiliateId?: string;
        leadId?: string | null;
        ruleCode?: string;
        severity?: Severity;
        evidence?: AffiliateViolationEvidence;
      };
      const { affiliateId, leadId, ruleCode, severity, evidence } = body;

      if (!affiliateId || !ruleCode || !severity || !evidence) {
        res.status(400).json({
          error: "affiliateId, ruleCode, severity, and evidence are required",
        });
        return;
      }
      if (!VALID_SEVERITIES.includes(severity)) {
        res.status(400).json({
          error: `severity must be one of: ${VALID_SEVERITIES.join(", ")}`,
        });
        return;
      }
      if (typeof evidence !== "object" || !evidence.source || !evidence.excerpt) {
        res.status(400).json({
          error: "evidence must include { source, excerpt } at minimum",
        });
        return;
      }

      const [inserted] = await db
        .insert(affiliateViolations)
        .values({
          affiliateId,
          leadId: leadId ?? null,
          detectionType: "admin_reported",
          ruleCode,
          severity,
          evidence,
          status: "open",
        })
        .returning();

      res.status(201).json({ violation: inserted });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to create admin-reported violation");
      res.status(500).json({ error: "Failed to create violation" });
    }
  });

  // ── PUT /compliance/violations/:id/status ────────────────────────────────
  router.put("/compliance/violations/:id/status", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;
      const body = req.body as {
        toStatus?: ViolationStatus;
        commissionAction?: "clawback" | "none" | null;
      };
      const { toStatus, commissionAction } = body;

      if (!toStatus || !VALID_VIOLATION_STATUSES.includes(toStatus)) {
        res.status(400).json({
          error: `toStatus must be one of: ${VALID_VIOLATION_STATUSES.join(", ")}`,
        });
        return;
      }

      const [existing] = await db
        .select()
        .from(affiliateViolations)
        .where(eq(affiliateViolations.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Violation not found" });
        return;
      }

      // Determine reviewer user id (board actor). `req.actor.userId` is
      // populated by the board auth middleware.
      const reviewerId =
        req.actor.type === "board" ? req.actor.userId ?? null : null;

      // Non-enforced transitions: simple update.
      if (toStatus !== "enforced" || commissionAction !== "clawback") {
        const [updated] = await db
          .update(affiliateViolations)
          .set({
            status: toStatus,
            reviewedByUserId: reviewerId,
            reviewedAt: new Date(),
          })
          .where(eq(affiliateViolations.id, id))
          .returning();
        res.json({ violation: updated });
        return;
      }

      // Enforced + clawback path — transactional update of commissions +
      // violation row + (for terminal severity) affiliate suspension.
      const result = await db.transaction(async (tx) => {
        const now = new Date();

        // Clawback logic: paid → clawed_back, else → reversed.
        const conds = [eq(commissions.affiliateId, existing.affiliateId)] as ReturnType<
          typeof eq
        >[];
        if (existing.leadId) {
          conds.push(eq(commissions.leadId, existing.leadId));
        }

        const clawedBack = await tx
          .update(commissions)
          .set({
            status: sql`CASE WHEN ${commissions.status} = 'paid' THEN 'clawed_back' ELSE 'reversed' END`,
            clawbackReason: "compliance_violation",
            updatedAt: now,
          })
          .where(and(...conds))
          .returning({ id: commissions.id });

        const [updatedViolation] = await tx
          .update(affiliateViolations)
          .set({
            status: "enforced",
            commissionsClawedBack: clawedBack.length,
            reviewedByUserId: reviewerId,
            reviewedAt: now,
          })
          .where(eq(affiliateViolations.id, id))
          .returning();

        // If terminal severity, suspend the affiliate.
        if (existing.severity === "terminal") {
          await tx
            .update(affiliates)
            .set({
              suspendedAt: now,
              suspensionReason: "compliance_terminal_violation",
              status: "suspended",
              updatedAt: now,
            })
            .where(eq(affiliates.id, existing.affiliateId));
        }

        return {
          violation: updatedViolation,
          commissionsClawedBack: clawedBack.length,
        };
      });

      res.json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to update violation status");
      res.status(500).json({ error: "Failed to update violation status" });
    }
  });

  // ── PUT /admin/affiliates/:id/suspend ────────────────────────────────────
  // Standalone suspend endpoint owned by this router. Board auth.
  router.put("/admin/affiliates/:id/suspend", async (req, res) => {
    try {
      assertBoard(req);

      const id = req.params.id as string;
      const { reason } = req.body as { reason?: string };

      if (!reason || typeof reason !== "string") {
        res.status(400).json({ error: "reason is required" });
        return;
      }

      const [existing] = await db
        .select({ id: affiliates.id })
        .from(affiliates)
        .where(eq(affiliates.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Affiliate not found" });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(affiliates)
        .set({
          suspendedAt: now,
          suspensionReason: reason,
          status: "suspended",
          updatedAt: now,
        })
        .where(eq(affiliates.id, id))
        .returning({
          id: affiliates.id,
          suspendedAt: affiliates.suspendedAt,
          suspensionReason: affiliates.suspensionReason,
          status: affiliates.status,
        });

      res.json({ affiliate: updated });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Failed to suspend affiliate");
      res.status(500).json({ error: "Failed to suspend affiliate" });
    }
  });

  // Suppress unused-import warning — `inArray` retained for future filter
  // extensions (e.g. status CSV filtering).
  void inArray;

  return router;
}
