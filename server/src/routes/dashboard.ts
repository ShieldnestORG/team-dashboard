import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { dashboardService } from "../services/dashboard.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";
import { logger } from "../middleware/logger.js";
import { assertCompanyAccess } from "./authz.js";

// Marketing-economics figures are MODELED, not GAAP revenue. This note is
// echoed in the API response so any consumer (and the future portal page)
// renders the numbers as directional estimates. See the header of
// 0128_member_economics_view.sql for the exact modeling assumptions.
const ECONOMICS_ESTIMATED_NOTE =
  "ESTIMATED / modeled marketing figures — derived from the attribution event " +
  "ledger and subscription status, not GAAP-accurate billing. gross_mrr is a " +
  "modeled monthly run-rate; realized_ltv is trailing net cash collected per " +
  "member. Directional ROI signal only.";

// Shape of one member_economics_by_campaign row. The view returns NUMERIC for
// the money/lifetime columns; pg returns those as strings, so we coerce.
interface EconomicsRow {
  utm_campaign: string;
  utm_source: string;
  new_members: number;
  active_members: number;
  churned_members: number;
  gross_mrr: number;
  net_mrr: number;
  avg_lifetime_months: number;
  realized_ltv: number;
}

export function dashboardRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const summary = await svc.summary(companyId);
    res.json(summary);
  });

  // -------------------- GET /university/economics --------------------
  // Read-only internal report: University membership economics rolled up to the
  // acquisition-campaign grain (utm_campaign + utm_source). Selects straight
  // from the member_economics_by_campaign view (0128 migration).
  //
  // Board-only — this is an internal marketing-ops surface, not a customer one.
  // Mirrors the board-only inline guard + logAdminAccess pattern used across the
  // admin routes (watchtower-admin.ts, intel-billing.ts).
  //
  // EVERY number returned is ESTIMATED / modeled (see ECONOMICS_ESTIMATED_NOTE
  // and the view header). The response carries that note explicitly.
  router.get(
    "/university/economics",
    logAdminAccess(db),
    async (req, res) => {
      if (req.actor?.type !== "board") {
        res.status(401).json({ error: "Admin only" });
        return;
      }

      try {
        const rows = (await db.execute(
          sql`SELECT
                utm_campaign,
                utm_source,
                new_members,
                active_members,
                churned_members,
                gross_mrr,
                net_mrr,
                avg_lifetime_months,
                realized_ltv
              FROM member_economics_by_campaign`,
        )) as unknown as Array<Record<string, unknown>>;

        const num = (v: unknown): number => {
          const n = typeof v === "number" ? v : Number(v ?? 0);
          return Number.isFinite(n) ? n : 0;
        };

        const campaigns: EconomicsRow[] = rows.map((r) => ({
          utm_campaign: String(r.utm_campaign ?? "(unattributed)"),
          utm_source: String(r.utm_source ?? "(unattributed)"),
          new_members: num(r.new_members),
          active_members: num(r.active_members),
          churned_members: num(r.churned_members),
          gross_mrr: num(r.gross_mrr),
          net_mrr: num(r.net_mrr),
          avg_lifetime_months: num(r.avg_lifetime_months),
          realized_ltv: num(r.realized_ltv),
        }));

        res.json({
          estimated: true,
          note: ECONOMICS_ESTIMATED_NOTE,
          generatedAt: new Date().toISOString(),
          campaigns,
        });
      } catch (err) {
        logger.error(
          { err },
          "dashboard: university economics report query failed",
        );
        res.status(500).json({ error: "Failed to load economics report" });
      }
    },
  );

  return router;
}
