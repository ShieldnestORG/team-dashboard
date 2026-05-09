import { Router, type Request, type Response } from "express";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  creditscoreContentDrafts,
  creditscoreSchemaImpls,
  creditscoreCompetitorScans,
  creditscoreSubscriptions,
  customerAccounts,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import {
  customerPortalService,
  PORTAL_SESSION_COOKIE,
} from "../services/customer-portal.js";

// ---------------------------------------------------------------------------
// Portal Agents routes — mounted at /api/portal/agents
//
// These routes expose read-only activity feeds + customer approve/reject
// actions for the 3 CreditScore agent output tables:
//   - creditscore_content_drafts   → kind "content_draft"
//   - creditscore_schema_impls     → kind "schema_impl"
//   - creditscore_competitor_scans → kind "competitor_scan"
//
// Auth: same cd_portal_session HMAC cookie as the rest of /api/portal.
// Ownership: items are scoped to subscriptions whose email matches the
// customer_accounts.email for the logged-in portal account.
//
// Per CLAUDE.md: cast req.params.* as string at every access site.
// ---------------------------------------------------------------------------

type ItemKind = "content_draft" | "schema_impl" | "competitor_scan";

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function readSessionCookie(req: Request): string | null {
  const header = req.headers["cookie"];
  if (typeof header !== "string") return null;
  const cookies = parseCookies(header);
  return cookies[PORTAL_SESSION_COOKIE] ?? null;
}

export function portalAgentsRoutes(db: Db): Router {
  const router = Router();
  const svc = customerPortalService(db);

  // ── Auth helper ─────────────────────────────────────────────────────────
  function requireSession(req: Request, res: Response): string | null {
    const cookie = readSessionCookie(req);
    const session = svc.verifySession(cookie);
    if (!session) {
      res.status(401).json({ error: "Unauthenticated" });
      return null;
    }
    return session.accountId;
  }

  // ── Resolve the customer's email from their account id ──────────────────
  async function getCustomerEmail(accountId: string): Promise<string | null> {
    const rows = await db
      .select({ email: customerAccounts.email })
      .from(customerAccounts)
      .where(eq(customerAccounts.id, accountId))
      .limit(1);
    return rows[0]?.email?.toLowerCase() ?? null;
  }

  // ── Resolve subscription ids the customer owns (via email join) ──────────
  async function getSubscriptionIds(email: string): Promise<string[]> {
    const rows = await db
      .select({ id: creditscoreSubscriptions.id })
      .from(creditscoreSubscriptions)
      .where(
        and(
          sql`LOWER(${creditscoreSubscriptions.email}) = ${email}`,
          or(
            eq(creditscoreSubscriptions.status, "active"),
            eq(creditscoreSubscriptions.status, "past_due"),
            eq(creditscoreSubscriptions.status, "fulfilled"),
          ),
        ),
      );
    return rows.map((r) => r.id);
  }

  // ── GET /feed?limit=N ────────────────────────────────────────────────────
  // Returns a merged reverse-chronological feed across all 3 tables for this
  // customer. Feed items are index-only (no heavy body fields).
  router.get("/feed", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;

    const rawLimit = req.query.limit;
    const limit = Math.min(
      200,
      Math.max(1, Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : 50),
    );

    try {
      const email = await getCustomerEmail(accountId);
      if (!email) {
        res.status(401).json({ error: "Account not found" });
        return;
      }
      const subIds = await getSubscriptionIds(email);
      if (subIds.length === 0) {
        res.json({ items: [] });
        return;
      }

      // Fetch index rows from each table. We pull a bit more than `limit` from
      // each so the merge can pick the most-recent `limit` overall.
      const fetchLimit = limit + 20;

      const [drafts, schemaImpls, competitorScans] = await Promise.all([
        db
          .select({
            id: creditscoreContentDrafts.id,
            title: creditscoreContentDrafts.title,
            status: creditscoreContentDrafts.status,
            createdAt: creditscoreContentDrafts.createdAt,
            domain: creditscoreContentDrafts.domain,
            targetSignal: creditscoreContentDrafts.targetSignal,
          })
          .from(creditscoreContentDrafts)
          .where(
            sql`${creditscoreContentDrafts.subscriptionId} = ANY(${sql.raw(`ARRAY[${subIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})`,
          )
          .orderBy(desc(creditscoreContentDrafts.createdAt))
          .limit(fetchLimit),

        db
          .select({
            id: creditscoreSchemaImpls.id,
            schemaType: creditscoreSchemaImpls.schemaType,
            status: creditscoreSchemaImpls.status,
            createdAt: creditscoreSchemaImpls.createdAt,
            domain: creditscoreSchemaImpls.domain,
          })
          .from(creditscoreSchemaImpls)
          .where(
            sql`${creditscoreSchemaImpls.subscriptionId} = ANY(${sql.raw(`ARRAY[${subIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})`,
          )
          .orderBy(desc(creditscoreSchemaImpls.createdAt))
          .limit(fetchLimit),

        db
          .select({
            id: creditscoreCompetitorScans.id,
            competitorDomain: creditscoreCompetitorScans.competitorDomain,
            customerDomain: creditscoreCompetitorScans.customerDomain,
            status: creditscoreCompetitorScans.status,
            createdAt: creditscoreCompetitorScans.createdAt,
            gapSummary: creditscoreCompetitorScans.gapSummary,
          })
          .from(creditscoreCompetitorScans)
          .where(
            sql`${creditscoreCompetitorScans.subscriptionId} = ANY(${sql.raw(`ARRAY[${subIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})`,
          )
          .orderBy(desc(creditscoreCompetitorScans.createdAt))
          .limit(fetchLimit),
      ]);

      type FeedItem = {
        id: string;
        kind: ItemKind;
        title: string;
        status: string;
        created_at: string;
        summary: string | null;
      };

      const items: FeedItem[] = [
        ...drafts.map((d) => ({
          id: d.id,
          kind: "content_draft" as ItemKind,
          title: d.title,
          status: d.status,
          created_at: d.createdAt.toISOString(),
          summary: d.targetSignal ?? d.domain,
        })),
        ...schemaImpls.map((s) => ({
          id: s.id,
          kind: "schema_impl" as ItemKind,
          title: `${s.schemaType} schema for ${s.domain}`,
          status: s.status,
          created_at: s.createdAt.toISOString(),
          summary: s.domain,
        })),
        ...competitorScans.map((c) => ({
          id: c.id,
          kind: "competitor_scan" as ItemKind,
          title: `Competitor scan: ${c.competitorDomain}`,
          status: c.status,
          created_at: c.createdAt.toISOString(),
          summary: c.gapSummary ?? c.customerDomain,
        })),
      ];

      // Sort merged list reverse-chronologically, then truncate.
      items.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      res.json({ items: items.slice(0, limit) });
    } catch (err) {
      logger.error({ err, accountId }, "portal/agents/feed: query failed");
      res.status(500).json({ error: "Failed to load agent feed" });
    }
  });

  // ── GET /items/:kind/:id ─────────────────────────────────────────────────
  // Full item body for one item. Returns the heavy content fields.
  router.get("/items/:kind/:id", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;

    const kind = req.params["kind"] as string;
    const id = req.params["id"] as string;

    if (!["content_draft", "schema_impl", "competitor_scan"].includes(kind)) {
      res.status(400).json({ error: "Invalid kind" });
      return;
    }

    try {
      const email = await getCustomerEmail(accountId);
      if (!email) {
        res.status(401).json({ error: "Account not found" });
        return;
      }
      const subIds = await getSubscriptionIds(email);
      if (subIds.length === 0) {
        res.status(404).json({ error: "Item not found" });
        return;
      }

      if (kind === "content_draft") {
        const rows = await db
          .select()
          .from(creditscoreContentDrafts)
          .where(
            and(
              eq(creditscoreContentDrafts.id, id),
              sql`${creditscoreContentDrafts.subscriptionId} = ANY(${sql.raw(`ARRAY[${subIds.map((sid) => `'${sid}'`).join(",")}]::uuid[]`)})`,
            ),
          )
          .limit(1);
        if (!rows.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
        const row = rows[0];
        res.json({
          id: row.id,
          kind: "content_draft",
          title: row.title,
          status: row.status,
          created_at: row.createdAt.toISOString(),
          domain: row.domain,
          slug: row.slug,
          targetSignal: row.targetSignal,
          htmlDraft: row.htmlDraft,
          markdownDraft: row.markdownDraft,
          reviewNotes: row.reviewNotes,
          approvedByCustomerAccountId: row.approvedByCustomerAccountId,
          rejectedByCustomerAccountId: row.rejectedByCustomerAccountId,
          customerRejectionReason: row.customerRejectionReason,
          customerActionedAt: row.customerActionedAt?.toISOString() ?? null,
        });
        return;
      }

      if (kind === "schema_impl") {
        const rows = await db
          .select()
          .from(creditscoreSchemaImpls)
          .where(
            and(
              eq(creditscoreSchemaImpls.id, id),
              sql`${creditscoreSchemaImpls.subscriptionId} = ANY(${sql.raw(`ARRAY[${subIds.map((sid) => `'${sid}'`).join(",")}]::uuid[]`)})`,
            ),
          )
          .limit(1);
        if (!rows.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
        const row = rows[0];
        res.json({
          id: row.id,
          kind: "schema_impl",
          title: `${row.schemaType} schema for ${row.domain}`,
          status: row.status,
          created_at: row.createdAt.toISOString(),
          domain: row.domain,
          schemaType: row.schemaType,
          jsonLd: row.jsonLd,
          htmlSnippet: row.htmlSnippet,
          reviewNotes: row.reviewNotes,
          approvedByCustomerAccountId: row.approvedByCustomerAccountId,
          rejectedByCustomerAccountId: row.rejectedByCustomerAccountId,
          customerRejectionReason: row.customerRejectionReason,
          customerActionedAt: row.customerActionedAt?.toISOString() ?? null,
        });
        return;
      }

      // kind === "competitor_scan"
      const rows = await db
        .select()
        .from(creditscoreCompetitorScans)
        .where(
          and(
            eq(creditscoreCompetitorScans.id, id),
            sql`${creditscoreCompetitorScans.subscriptionId} = ANY(${sql.raw(`ARRAY[${subIds.map((sid) => `'${sid}'`).join(",")}]::uuid[]`)})`,
          ),
        )
        .limit(1);
      if (!rows.length) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      const row = rows[0];
      res.json({
        id: row.id,
        kind: "competitor_scan",
        title: `Competitor scan: ${row.competitorDomain}`,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        customerDomain: row.customerDomain,
        competitorDomain: row.competitorDomain,
        competitorScore: row.competitorScore,
        customerScore: row.customerScore,
        auditJson: row.auditJson,
        gapSummary: row.gapSummary,
        approvedByCustomerAccountId: row.approvedByCustomerAccountId,
        rejectedByCustomerAccountId: row.rejectedByCustomerAccountId,
        customerRejectionReason: row.customerRejectionReason,
        customerActionedAt: row.customerActionedAt?.toISOString() ?? null,
      });
    } catch (err) {
      logger.error({ err, accountId, kind, id }, "portal/agents/items: query failed");
      res.status(500).json({ error: "Failed to load item" });
    }
  });

  // ── POST /items/:kind/:id/approve ────────────────────────────────────────
  // Idempotent. Sets status to "approved" and records approvedByCustomerAccountId.
  router.post("/items/:kind/:id/approve", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;

    const kind = req.params["kind"] as string;
    const id = req.params["id"] as string;

    if (!["content_draft", "schema_impl", "competitor_scan"].includes(kind)) {
      res.status(400).json({ error: "Invalid kind" });
      return;
    }

    try {
      const email = await getCustomerEmail(accountId);
      if (!email) {
        res.status(401).json({ error: "Account not found" });
        return;
      }
      const subIds = await getSubscriptionIds(email);
      if (subIds.length === 0) {
        res.status(404).json({ error: "Item not found" });
        return;
      }

      const now = new Date();
      const subIdFilter = sql`= ANY(${sql.raw(`ARRAY[${subIds.map((sid) => `'${sid}'`).join(",")}]::uuid[]`)})`;

      if (kind === "content_draft") {
        const updated = await db
          .update(creditscoreContentDrafts)
          .set({
            status: "approved",
            approvedByCustomerAccountId: accountId,
            rejectedByCustomerAccountId: null,
            customerRejectionReason: null,
            customerActionedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(creditscoreContentDrafts.id, id),
              sql`${creditscoreContentDrafts.subscriptionId} ${subIdFilter}`,
            ),
          )
          .returning({ id: creditscoreContentDrafts.id });
        if (!updated.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
      } else if (kind === "schema_impl") {
        const updated = await db
          .update(creditscoreSchemaImpls)
          .set({
            status: "approved",
            approvedByCustomerAccountId: accountId,
            rejectedByCustomerAccountId: null,
            customerRejectionReason: null,
            customerActionedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(creditscoreSchemaImpls.id, id),
              sql`${creditscoreSchemaImpls.subscriptionId} ${subIdFilter}`,
            ),
          )
          .returning({ id: creditscoreSchemaImpls.id });
        if (!updated.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
      } else {
        // competitor_scan
        const updated = await db
          .update(creditscoreCompetitorScans)
          .set({
            approvedByCustomerAccountId: accountId,
            rejectedByCustomerAccountId: null,
            customerRejectionReason: null,
            customerActionedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(creditscoreCompetitorScans.id, id),
              sql`${creditscoreCompetitorScans.subscriptionId} ${subIdFilter}`,
            ),
          )
          .returning({ id: creditscoreCompetitorScans.id });
        if (!updated.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
      }

      await svc.logAction(accountId, "agent_item_approved", { kind, id });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, accountId, kind, id }, "portal/agents/approve: failed");
      res.status(500).json({ error: "Failed to approve item" });
    }
  });

  // ── POST /items/:kind/:id/reject ─────────────────────────────────────────
  // Idempotent. Sets status to "rejected" and records rejectedByCustomerAccountId.
  // Optional body: { reason: string }
  router.post("/items/:kind/:id/reject", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;

    const kind = req.params["kind"] as string;
    const id = req.params["id"] as string;

    if (!["content_draft", "schema_impl", "competitor_scan"].includes(kind)) {
      res.status(400).json({ error: "Invalid kind" });
      return;
    }

    const body = (req.body ?? {}) as { reason?: unknown };
    const reason =
      typeof body.reason === "string" ? body.reason.slice(0, 1000) : null;

    try {
      const email = await getCustomerEmail(accountId);
      if (!email) {
        res.status(401).json({ error: "Account not found" });
        return;
      }
      const subIds = await getSubscriptionIds(email);
      if (subIds.length === 0) {
        res.status(404).json({ error: "Item not found" });
        return;
      }

      const now = new Date();
      const subIdFilter = sql`= ANY(${sql.raw(`ARRAY[${subIds.map((sid) => `'${sid}'`).join(",")}]::uuid[]`)})`;

      if (kind === "content_draft") {
        const updated = await db
          .update(creditscoreContentDrafts)
          .set({
            status: "rejected",
            rejectedByCustomerAccountId: accountId,
            approvedByCustomerAccountId: null,
            customerRejectionReason: reason,
            customerActionedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(creditscoreContentDrafts.id, id),
              sql`${creditscoreContentDrafts.subscriptionId} ${subIdFilter}`,
            ),
          )
          .returning({ id: creditscoreContentDrafts.id });
        if (!updated.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
      } else if (kind === "schema_impl") {
        const updated = await db
          .update(creditscoreSchemaImpls)
          .set({
            status: "rejected",
            rejectedByCustomerAccountId: accountId,
            approvedByCustomerAccountId: null,
            customerRejectionReason: reason,
            customerActionedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(creditscoreSchemaImpls.id, id),
              sql`${creditscoreSchemaImpls.subscriptionId} ${subIdFilter}`,
            ),
          )
          .returning({ id: creditscoreSchemaImpls.id });
        if (!updated.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
      } else {
        // competitor_scan
        const updated = await db
          .update(creditscoreCompetitorScans)
          .set({
            rejectedByCustomerAccountId: accountId,
            approvedByCustomerAccountId: null,
            customerRejectionReason: reason,
            customerActionedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(creditscoreCompetitorScans.id, id),
              sql`${creditscoreCompetitorScans.subscriptionId} ${subIdFilter}`,
            ),
          )
          .returning({ id: creditscoreCompetitorScans.id });
        if (!updated.length) {
          res.status(404).json({ error: "Item not found" });
          return;
        }
      }

      await svc.logAction(accountId, "agent_item_rejected", { kind, id, reason });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, accountId, kind, id }, "portal/agents/reject: failed");
      res.status(500).json({ error: "Failed to reject item" });
    }
  });

  return router;
}
