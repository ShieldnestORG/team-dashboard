/**
 * Partner reports — monthly metrics email + site health monitoring.
 *
 * - generatePartnerMetricsEmail: builds HTML email with per-partner stats
 * - sendPartnerMetricsReport: sends the metrics email via alerting SMTP
 * - checkPartnerSiteHealth: HEAD-checks deployed partner sites, alerts on failures
 */

import { eq, and, gte, sql, count } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerClicks, partnerSiteContent } from "@paperclipai/db";
import { sendAlert } from "./alerting.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const DASHBOARD_BASE = "https://team-dashboard-cyan.vercel.app";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PartnerStats {
  id: string;
  slug: string;
  name: string;
  industry: string;
  location: string | null;
  status: string;
  tier: string;
  totalClicks: number;
  recentClicks: number;
  contentMentions: number;
  siteContentCount: number;
  siteDeployStatus: string;
  dashboardToken: string | null;
  baselineAnalytics: {
    capturedAt: string;
    monthlyVisitors?: number;
    domainAuthority?: number;
    topKeywords?: string[];
    sourceBreakdown?: Record<string, number>;
  } | null;
  clickSources: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Source colors for the horizontal bar chart
// ---------------------------------------------------------------------------

const SOURCE_COLORS: Record<string, string> = {
  tweet: "#1DA1F2",
  blog: "#7c3aed",
  linkedin: "#0A66C2",
  reddit: "#FF4500",
  discord: "#5865F2",
  direct: "#10B981",
  organic: "#F59E0B",
};

function colorForSource(source: string): string {
  return SOURCE_COLORS[source.toLowerCase()] || "#6B7280";
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

async function gatherPartnerStats(db: Db): Promise<PartnerStats[]> {
  // Get active/trial partners
  const partners = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        sql`${partnerCompanies.status} IN ('active', 'trial')`,
      ),
    );

  if (partners.length === 0) return [];

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const results: PartnerStats[] = [];

  for (const p of partners) {
    // Total clicks
    const [totalRow] = await db
      .select({ value: count() })
      .from(partnerClicks)
      .where(
        and(
          eq(partnerClicks.partnerSlug, p.slug),
          eq(partnerClicks.companyId, COMPANY_ID),
        ),
      );

    // Clicks in last 30 days
    const [recentRow] = await db
      .select({ value: count() })
      .from(partnerClicks)
      .where(
        and(
          eq(partnerClicks.partnerSlug, p.slug),
          eq(partnerClicks.companyId, COMPANY_ID),
          gte(partnerClicks.clickedAt, thirtyDaysAgo),
        ),
      );

    // Click sources breakdown (last 30 days)
    const sourceRows = await db
      .select({
        sourceType: partnerClicks.sourceType,
        value: count(),
      })
      .from(partnerClicks)
      .where(
        and(
          eq(partnerClicks.partnerSlug, p.slug),
          eq(partnerClicks.companyId, COMPANY_ID),
          gte(partnerClicks.clickedAt, thirtyDaysAgo),
        ),
      )
      .groupBy(partnerClicks.sourceType);

    const clickSources: Record<string, number> = {};
    for (const row of sourceRows) {
      clickSources[row.sourceType || "unknown"] = row.value;
    }

    // Site content count
    const [siteContentRow] = await db
      .select({ value: count() })
      .from(partnerSiteContent)
      .where(eq(partnerSiteContent.partnerId, p.id));

    results.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      industry: p.industry,
      location: p.location,
      status: p.status,
      tier: p.tier,
      totalClicks: totalRow?.value ?? 0,
      recentClicks: recentRow?.value ?? 0,
      contentMentions: p.contentMentions,
      siteContentCount: siteContentRow?.value ?? 0,
      siteDeployStatus: p.siteDeployStatus,
      dashboardToken: p.dashboardToken,
      baselineAnalytics: p.baselineAnalytics ?? null,
      clickSources,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// HTML email generation
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSourceBars(sources: Record<string, number>): string {
  const entries = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return `<tr><td style="color:#888;font-size:12px;padding:4px 0">No click data yet</td></tr>`;
  }
  const maxVal = Math.max(...entries.map(([, v]) => v));

  return entries
    .map(([source, val]) => {
      const pct = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
      const color = colorForSource(source);
      return `<tr>
        <td style="width:80px;font-size:12px;color:#aaa;padding:3px 0">${escapeHtml(source)}</td>
        <td style="padding:3px 0">
          <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
            <td style="background:${color};width:${pct}%;height:14px;border-radius:3px">&nbsp;</td>
            <td style="width:${100 - pct}%">&nbsp;</td>
          </tr></table>
        </td>
        <td style="width:40px;font-size:12px;color:#ccc;text-align:right;padding:3px 0">${val}</td>
      </tr>`;
    })
    .join("");
}

function buildPartnerCard(p: PartnerStats): string {
  const dashboardLink = p.dashboardToken
    ? `${DASHBOARD_BASE}/partner-dashboard/${p.slug}?token=${p.dashboardToken}`
    : null;

  const tierBadge = p.tier === "proof"
    ? `<span style="background:#4B5563;color:#E5E7EB;font-size:10px;padding:2px 6px;border-radius:4px">PROOF</span>`
    : `<span style="background:#7c3aed;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px">${escapeHtml(p.tier.toUpperCase())}</span>`;

  const statusColor = p.status === "active" ? "#10B981" : "#F59E0B";

  let baselineHtml = "";
  if (p.baselineAnalytics?.monthlyVisitors != null) {
    baselineHtml = `
      <tr>
        <td colspan="3" style="padding:8px 0 4px 0">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="background:#111827;border-radius:6px;padding:10px">
                <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Before vs After</div>
                <div style="font-size:16px;color:#e0e0e0;margin-top:4px">
                  Baseline visitors: <strong>${p.baselineAnalytics.monthlyVisitors.toLocaleString()}</strong>/mo
                </div>
                <div style="font-size:12px;color:#6B7280;margin-top:2px">
                  Captured ${escapeHtml(p.baselineAnalytics.capturedAt?.slice(0, 10) || "—")}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  return `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#1a1a2e;border-radius:8px;margin:12px 0">
      <tr><td style="padding:16px">
        <!-- Header -->
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td>
              <div style="font-size:18px;font-weight:700;color:#e0e0e0">${escapeHtml(p.name)}</div>
              <div style="font-size:13px;color:#9CA3AF;margin-top:2px">
                ${escapeHtml(p.industry)}${p.location ? ` &middot; ${escapeHtml(p.location)}` : ""}
                &middot; ${tierBadge}
                &middot; <span style="color:${statusColor}">${escapeHtml(p.status)}</span>
              </div>
            </td>
          </tr>
        </table>

        <!-- Stats row -->
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px">
          <tr>
            <td style="text-align:center;padding:8px">
              <div style="font-size:28px;font-weight:700;color:#7c3aed">${p.recentClicks}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Clicks (30d)</div>
            </td>
            <td style="text-align:center;padding:8px">
              <div style="font-size:28px;font-weight:700;color:#e0e0e0">${p.totalClicks}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Total Clicks</div>
            </td>
            <td style="text-align:center;padding:8px">
              <div style="font-size:28px;font-weight:700;color:#e0e0e0">${p.contentMentions}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Mentions</div>
            </td>
          </tr>
          <tr>
            <td style="text-align:center;padding:8px">
              <div style="font-size:28px;font-weight:700;color:#e0e0e0">${p.siteContentCount}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Site Pages</div>
            </td>
            <td style="text-align:center;padding:8px" colspan="2">
              <div style="font-size:14px;font-weight:600;color:${p.siteDeployStatus === "deployed" ? "#10B981" : "#F59E0B"}">${escapeHtml(p.siteDeployStatus)}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Site Status</div>
            </td>
          </tr>
        </table>

        <!-- Click sources -->
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px">
          <tr><td style="font-size:12px;color:#9CA3AF;padding-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Click Sources (30d)</td></tr>
          ${buildSourceBars(p.clickSources)}
        </table>

        <!-- Baseline -->
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${baselineHtml}
        </table>

        <!-- Dashboard link -->
        ${dashboardLink ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:10px"><tr><td><a href="${escapeHtml(dashboardLink)}" style="color:#7c3aed;font-size:13px;text-decoration:underline">View Partner Dashboard</a></td></tr></table>` : ""}
      </td></tr>
    </table>`;
}

export async function generatePartnerMetricsEmail(db: Db): Promise<string> {
  const stats = await gatherPartnerStats(db);

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const partnerCards =
    stats.length > 0
      ? stats.map(buildPartnerCard).join("")
      : `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#1a1a2e;border-radius:8px;margin:12px 0"><tr><td style="padding:24px;text-align:center;color:#9CA3AF;font-size:14px">No active or trial partners found.</td></tr></table>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#0f0f23;font-family:system-ui,-apple-system,sans-serif">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0f0f23">
  <tr><td align="center" style="padding:24px 16px">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px">
      <!-- Header -->
      <tr><td style="padding:0 0 20px 0">
        <div style="font-size:24px;font-weight:700;color:#e0e0e0">AEO Partner Network</div>
        <div style="font-size:14px;color:#9CA3AF;margin-top:4px">Monthly Metrics Report &mdash; ${escapeHtml(monthLabel)}</div>
        <div style="height:3px;background:#7c3aed;border-radius:2px;margin-top:12px;width:60px"></div>
      </td></tr>

      <!-- Summary -->
      <tr><td style="padding:0 0 12px 0">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#1a1a2e;border-radius:8px">
          <tr>
            <td style="text-align:center;padding:16px">
              <div style="font-size:32px;font-weight:700;color:#7c3aed">${stats.length}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Active Partners</div>
            </td>
            <td style="text-align:center;padding:16px">
              <div style="font-size:32px;font-weight:700;color:#e0e0e0">${stats.reduce((s, p) => s + p.recentClicks, 0)}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Total Clicks (30d)</div>
            </td>
            <td style="text-align:center;padding:16px">
              <div style="font-size:32px;font-weight:700;color:#e0e0e0">${stats.reduce((s, p) => s + p.contentMentions, 0)}</div>
              <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px">Total Mentions</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Partner Cards -->
      <tr><td>
        ${partnerCards}
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:20px 0 0 0;text-align:center">
        <div style="font-size:11px;color:#6B7280">Generated by Coherence Daddy Team Dashboard</div>
        <div style="font-size:11px;color:#6B7280;margin-top:4px">
          <a href="${DASHBOARD_BASE}/partners" style="color:#7c3aed;text-decoration:underline">Admin Panel</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Send report
// ---------------------------------------------------------------------------

export async function sendPartnerMetricsReport(db: Db): Promise<void> {
  try {
    const html = await generatePartnerMetricsEmail(db);
    await sendAlert(
      "service_down" as any,
      "AEO Partner Network — Monthly Report",
      html,
    );
    logger.info("Partner metrics email sent");
  } catch (err) {
    logger.error({ err }, "Failed to send partner metrics email");
  }
}

// ---------------------------------------------------------------------------
// Site health check
// ---------------------------------------------------------------------------

export async function checkPartnerSiteHealth(db: Db): Promise<void> {
  const partners = await db
    .select({
      name: partnerCompanies.name,
      slug: partnerCompanies.slug,
      siteUrl: partnerCompanies.siteUrl,
    })
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        eq(partnerCompanies.siteDeployStatus, "deployed"),
        sql`${partnerCompanies.siteUrl} IS NOT NULL`,
      ),
    );

  if (partners.length === 0) {
    logger.info("Partner site health check: no deployed sites to check");
    return;
  }

  let healthy = 0;
  let down = 0;

  for (const p of partners) {
    if (!p.siteUrl) continue;

    try {
      const resp = await fetch(p.siteUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        healthy++;
      } else {
        down++;
        await sendAlert(
          "service_down",
          `Partner site down: ${p.name}`,
          `${p.siteUrl} returned ${resp.status}`,
        );
      }
    } catch (err) {
      down++;
      const reason = err instanceof Error ? err.message : String(err);
      await sendAlert(
        "service_down",
        `Partner site down: ${p.name}`,
        `${p.siteUrl} — ${reason}`,
      );
    }
  }

  logger.info(
    { healthy, down },
    `Partner site health check: ${healthy} healthy, ${down} down`,
  );
}
