import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import {
  getBrevoAccount,
  getBrevoEmailStats,
  getBrevoListCount,
  getBrevoListContacts,
} from "../services/brevo.js";
import { revenueSummary, listMembers, type CockpitMember } from "../services/cockpit-metrics.js";

// The Brevo "Founding" contact list (free-tier signups).
const FOUNDING_LIST_ID = 3;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function cockpitRoutes(db: Db) {
  const router = Router();

  // ---- Email health (Brevo account + 30d stats + founding list size) ----
  router.get("/companies/:companyId/cockpit/email-health", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const [account, stats, list] = await Promise.all([
      getBrevoAccount(),
      getBrevoEmailStats(),
      getBrevoListCount(FOUNDING_LIST_ID),
    ]);

    const planName =
      Array.isArray(account?.plan) && account.plan.length
        ? (account.plan[0]?.type as string | undefined)
        : undefined;

    res.json({
      account: {
        email: account?.email ?? "",
        ...(planName ? { plan: planName } : {}),
      },
      stats: {
        requests: num(stats?.requests),
        delivered: num(stats?.delivered),
        hardBounces: num(stats?.hardBounces),
        softBounces: num(stats?.softBounces),
        opens: num(stats?.opens),
        clicks: num(stats?.clicks),
      },
      foundingList: {
        id: FOUNDING_LIST_ID,
        total: num(list?.totalSubscribers ?? list?.uniqueSubscribers),
      },
    });
  });

  // ---- Revenue summary (university_subscriptions rollup) ----
  router.get("/companies/:companyId/cockpit/revenue", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const summary = await revenueSummary(db);
    res.json(summary);
  });

  // ---- Members (paying members ∪ Brevo founding-list free signups) ----
  router.get("/companies/:companyId/cockpit/members", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const q = (req.query.q as string | undefined)?.trim() || undefined;

    // Paying members from the DB (already tagged tier:'member').
    const members = await listMembers(db, q);

    // Free-tier signups from the Brevo founding list. Anyone NOT already a
    // paying member becomes a tier:'free' row.
    const memberEmails = new Set(members.map((m) => m.email.toLowerCase()));
    const listContacts = await getBrevoListContacts(FOUNDING_LIST_ID);
    const free: CockpitMember[] = [];
    for (const contact of listContacts?.contacts ?? []) {
      const email = (contact.email ?? "").trim().toLowerCase();
      if (!email || memberEmails.has(email)) continue;
      memberEmails.add(email);
      const attrs = contact.attributes ?? {};
      const displayName =
        (attrs.FIRSTNAME && attrs.LASTNAME
          ? `${attrs.FIRSTNAME} ${attrs.LASTNAME}`
          : (attrs.FIRSTNAME ?? attrs.NAME ?? attrs.FULLNAME)) as string | undefined;
      free.push({
        email,
        displayName: displayName ? String(displayName).trim() : null,
        status: null,
        plan: null,
        founding: true,
        tier: "free",
        joinedAt: null,
      });
    }

    // Honor ?q over the merged list (members are already filtered in listMembers,
    // so this only narrows the Brevo free rows).
    const needle = q?.toLowerCase();
    const freeFiltered = needle
      ? free.filter(
          (m) =>
            m.email.toLowerCase().includes(needle) ||
            (m.displayName ?? "").toLowerCase().includes(needle),
        )
      : free;

    const merged = [...members, ...freeFiltered];
    const paying = members.length;

    res.json({
      counts: {
        total: merged.length,
        paying,
        free: freeFiltered.length,
      },
      members: merged,
    });
  });

  return router;
}
