import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  intelCompanies,
  directoryListings,
  directoryListingEvents,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { stripeRequest, stripeConfigured } from "./stripe-client.js";
import { sendTransactional } from "./email-templates.js";

// ---------------------------------------------------------------------------
// Listing tiers — prices are in cents/month. Stripe price IDs resolved via env.
// ---------------------------------------------------------------------------

export type ListingTierSlug = "featured" | "verified" | "boosted";

export const LISTING_TIERS: Record<
  ListingTierSlug,
  { slug: ListingTierSlug; label: string; monthlyPriceCents: number; priceIdEnv: string }
> = {
  featured: {
    slug: "featured",
    label: "Featured",
    monthlyPriceCents: 19900,
    priceIdEnv: "STRIPE_PRICE_FEATURED",
  },
  verified: {
    slug: "verified",
    label: "Verified",
    monthlyPriceCents: 49900,
    priceIdEnv: "STRIPE_PRICE_VERIFIED",
  },
  boosted: {
    slug: "boosted",
    label: "Boosted",
    monthlyPriceCents: 149900,
    priceIdEnv: "STRIPE_PRICE_BOOSTED",
  },
};

export function getTierPriceId(tier: ListingTierSlug): string | null {
  const conf = LISTING_TIERS[tier];
  if (!conf) return null;
  const v = process.env[conf.priceIdEnv];
  return v && v.trim() ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// Shapes returned from list endpoints
// ---------------------------------------------------------------------------

export interface CompanyListingRow {
  id: number;
  slug: string;
  name: string;
  category: string;
  directory: string;
  website: string | null;
  githubOrg: string | null;
  twitterHandle: string | null;
  subreddit: string | null;
  contactEmail: string | null;
  contactName: string | null;
  contactNotes: string | null;
  listing: {
    id: number;
    tier: string;
    status: string;
    monthlyPriceCents: number;
    currentPeriodEnd: string | null;
    lastOutreachAt: string | null;
    startedAt: string | null;
    checkoutUrl: string | null;
  } | null;
}

export interface ListingStats {
  totalCompanies: number;
  prospects: number;
  contacted: number;
  checkoutSent: number;
  active: number;
  pastDue: number;
  canceled: number;
  expired: number;
  withContactEmail: number;
  mrrCents: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function directoryListingsService(db: Db) {
  async function recordEvent(args: {
    listingId: number | null;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    payload?: unknown;
  }): Promise<void> {
    try {
      await db.insert(directoryListingEvents).values({
        listingId: args.listingId,
        eventType: args.eventType,
        fromStatus: args.fromStatus ?? null,
        toStatus: args.toStatus ?? null,
        payload: (args.payload ?? null) as unknown,
      });
    } catch (err) {
      logger.warn({ err, args }, "directory-listings: event log write failed");
    }
  }

  async function listCompaniesWithListings(opts: {
    directory?: string;
    search?: string;
    status?: string; // 'all' | 'prospect' | 'contacted' | 'checkout_sent' | 'active' | 'past_due' | 'canceled' | 'expired' | 'any_listing' | 'no_listing'
    limit?: number;
    offset?: number;
  }): Promise<{ items: CompanyListingRow[]; total: number }> {
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 500);
    const offset = Math.max(0, opts.offset ?? 0);
    const searchTerm = (opts.search ?? "").trim();

    // Latest listing per company — window function subquery.
    // Use LEFT JOIN so we include all companies (even with no listing).
    const rows = await db.execute(sql`
      WITH latest_listings AS (
        SELECT DISTINCT ON (company_id)
          id, company_id, tier, status, monthly_price_cents,
          current_period_end, last_outreach_at, started_at, checkout_url
        FROM directory_listings
        ORDER BY company_id, created_at DESC
      )
      SELECT
        c.id, c.slug, c.name, c.category, c.directory,
        c.website, c.github_org, c.twitter_handle, c.subreddit,
        c.contact_email, c.contact_name, c.contact_notes,
        l.id AS l_id, l.tier AS l_tier, l.status AS l_status,
        l.monthly_price_cents AS l_price, l.current_period_end AS l_period_end,
        l.last_outreach_at AS l_last_outreach, l.started_at AS l_started,
        l.checkout_url AS l_checkout_url
      FROM intel_companies c
      LEFT JOIN latest_listings l ON l.company_id = c.id
      WHERE
        (${opts.directory ?? null}::text IS NULL OR c.directory = ${opts.directory ?? null})
        AND (
          ${searchTerm === "" ? 1 : 0}::int = 1
          OR c.name ILIKE ${"%" + searchTerm + "%"}
          OR c.slug ILIKE ${"%" + searchTerm + "%"}
          OR c.category ILIKE ${"%" + searchTerm + "%"}
          OR COALESCE(c.contact_email, '') ILIKE ${"%" + searchTerm + "%"}
          OR COALESCE(c.website, '') ILIKE ${"%" + searchTerm + "%"}
          OR COALESCE(c.twitter_handle, '') ILIKE ${"%" + searchTerm + "%"}
        )
        AND (
          ${opts.status ?? "all"}::text = 'all'
          OR (${opts.status ?? "all"}::text = 'any_listing' AND l.id IS NOT NULL)
          OR (${opts.status ?? "all"}::text = 'no_listing' AND l.id IS NULL)
          OR l.status = ${opts.status ?? "all"}
        )
      ORDER BY
        CASE WHEN l.status = 'active' THEN 0
             WHEN l.status = 'past_due' THEN 1
             WHEN l.status = 'checkout_sent' THEN 2
             WHEN l.status = 'contacted' THEN 3
             WHEN l.status = 'prospect' THEN 4
             ELSE 5 END,
        c.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const list = (rows as unknown as { rows?: Record<string, unknown>[] }).rows
      ?? (rows as unknown as Record<string, unknown>[]);

    // Count query — same filters minus ordering/pagination.
    const countRes = await db.execute(sql`
      WITH latest_listings AS (
        SELECT DISTINCT ON (company_id) id, company_id, status
        FROM directory_listings
        ORDER BY company_id, created_at DESC
      )
      SELECT COUNT(*)::int AS total
      FROM intel_companies c
      LEFT JOIN latest_listings l ON l.company_id = c.id
      WHERE
        (${opts.directory ?? null}::text IS NULL OR c.directory = ${opts.directory ?? null})
        AND (
          ${searchTerm === "" ? 1 : 0}::int = 1
          OR c.name ILIKE ${"%" + searchTerm + "%"}
          OR c.slug ILIKE ${"%" + searchTerm + "%"}
          OR c.category ILIKE ${"%" + searchTerm + "%"}
          OR COALESCE(c.contact_email, '') ILIKE ${"%" + searchTerm + "%"}
          OR COALESCE(c.website, '') ILIKE ${"%" + searchTerm + "%"}
          OR COALESCE(c.twitter_handle, '') ILIKE ${"%" + searchTerm + "%"}
        )
        AND (
          ${opts.status ?? "all"}::text = 'all'
          OR (${opts.status ?? "all"}::text = 'any_listing' AND l.id IS NOT NULL)
          OR (${opts.status ?? "all"}::text = 'no_listing' AND l.id IS NULL)
          OR l.status = ${opts.status ?? "all"}
        )
    `);
    const countList = (countRes as unknown as { rows?: { total: number }[] }).rows
      ?? (countRes as unknown as { total: number }[]);
    const total = Number(countList?.[0]?.total ?? 0);

    const items: CompanyListingRow[] = (list ?? []).map((r) => ({
      id: Number(r.id),
      slug: String(r.slug),
      name: String(r.name),
      category: String(r.category),
      directory: String(r.directory),
      website: (r.website as string | null) ?? null,
      githubOrg: (r.github_org as string | null) ?? null,
      twitterHandle: (r.twitter_handle as string | null) ?? null,
      subreddit: (r.subreddit as string | null) ?? null,
      contactEmail: (r.contact_email as string | null) ?? null,
      contactName: (r.contact_name as string | null) ?? null,
      contactNotes: (r.contact_notes as string | null) ?? null,
      listing: r.l_id
        ? {
            id: Number(r.l_id),
            tier: String(r.l_tier),
            status: String(r.l_status),
            monthlyPriceCents: Number(r.l_price ?? 0),
            currentPeriodEnd: r.l_period_end
              ? new Date(r.l_period_end as string).toISOString()
              : null,
            lastOutreachAt: r.l_last_outreach
              ? new Date(r.l_last_outreach as string).toISOString()
              : null,
            startedAt: r.l_started
              ? new Date(r.l_started as string).toISOString()
              : null,
            checkoutUrl: (r.l_checkout_url as string | null) ?? null,
          }
        : null,
    }));

    return { items, total };
  }

  async function getStats(): Promise<ListingStats> {
    const totalRows = await db.execute(
      sql`SELECT COUNT(*)::int AS total FROM intel_companies`,
    );
    const totalList = (totalRows as unknown as { rows?: { total: number }[] }).rows
      ?? (totalRows as unknown as { total: number }[]);
    const totalCompanies = Number(totalList?.[0]?.total ?? 0);

    const emailRows = await db.execute(
      sql`SELECT COUNT(*)::int AS total FROM intel_companies WHERE contact_email IS NOT NULL AND contact_email <> ''`,
    );
    const emailList = (emailRows as unknown as { rows?: { total: number }[] }).rows
      ?? (emailRows as unknown as { total: number }[]);
    const withContactEmail = Number(emailList?.[0]?.total ?? 0);

    const statusRows = await db.execute(sql`
      WITH latest_listings AS (
        SELECT DISTINCT ON (company_id) status, monthly_price_cents
        FROM directory_listings
        ORDER BY company_id, created_at DESC
      )
      SELECT status, COUNT(*)::int AS cnt,
             SUM(CASE WHEN status = 'active' THEN monthly_price_cents ELSE 0 END)::int AS mrr
      FROM latest_listings
      GROUP BY status
    `);
    const statusList = (statusRows as unknown as {
      rows?: { status: string; cnt: number; mrr: number }[];
    }).rows ?? (statusRows as unknown as { status: string; cnt: number; mrr: number }[]);

    const counts: Record<string, number> = {};
    let mrrCents = 0;
    for (const row of statusList ?? []) {
      counts[row.status] = Number(row.cnt);
      mrrCents += Number(row.mrr ?? 0);
    }

    return {
      totalCompanies,
      prospects: counts["prospect"] ?? 0,
      contacted: counts["contacted"] ?? 0,
      checkoutSent: counts["checkout_sent"] ?? 0,
      active: counts["active"] ?? 0,
      pastDue: counts["past_due"] ?? 0,
      canceled: counts["canceled"] ?? 0,
      expired: counts["expired"] ?? 0,
      withContactEmail,
      mrrCents,
    };
  }

  async function upsertContact(
    companyId: number,
    contact: {
      email?: string | null;
      name?: string | null;
      notes?: string | null;
      source?: string | null;
    },
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (contact.email !== undefined) patch.contactEmail = contact.email?.trim() || null;
    if (contact.name !== undefined) patch.contactName = contact.name?.trim() || null;
    if (contact.notes !== undefined) patch.contactNotes = contact.notes ?? null;
    if (contact.source !== undefined) patch.contactSource = contact.source ?? null;
    if (contact.email) patch.contactVerifiedAt = new Date();
    if (Object.keys(patch).length === 0) return;
    await db
      .update(intelCompanies)
      .set(patch)
      .where(eq(intelCompanies.id, companyId));
  }

  async function getCompanyListings(companyId: number) {
    return db
      .select()
      .from(directoryListings)
      .where(eq(directoryListings.companyId, companyId))
      .orderBy(desc(directoryListings.createdAt));
  }

  async function getListingById(id: number) {
    const rows = await db
      .select()
      .from(directoryListings)
      .where(eq(directoryListings.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getListingEvents(listingId: number, limit = 50) {
    return db
      .select()
      .from(directoryListingEvents)
      .where(eq(directoryListingEvents.listingId, listingId))
      .orderBy(desc(directoryListingEvents.createdAt))
      .limit(limit);
  }

  async function createCheckoutSession(args: {
    companyId: number;
    tier: ListingTierSlug;
  }): Promise<{ url: string; listingId: number }> {
    if (!stripeConfigured()) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }
    const tierConf = LISTING_TIERS[args.tier];
    if (!tierConf) throw new Error(`Unknown tier: ${args.tier}`);
    const priceId = getTierPriceId(args.tier);
    if (!priceId) {
      throw new Error(`Tier ${args.tier} has no Stripe price configured (${tierConf.priceIdEnv})`);
    }

    const company = await db
      .select()
      .from(intelCompanies)
      .where(eq(intelCompanies.id, args.companyId))
      .limit(1);
    if (company.length === 0) throw new Error(`Company ${args.companyId} not found`);
    const c = company[0];
    if (!c.contactEmail) {
      throw new Error("Company has no contact_email — add contact first");
    }

    const successUrl =
      process.env.DIRECTORY_CHECKOUT_SUCCESS_URL ||
      "https://directory.coherencedaddy.com/thanks?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl =
      process.env.DIRECTORY_CHECKOUT_CANCEL_URL ||
      "https://directory.coherencedaddy.com/";

    const session = await stripeRequest<{ id: string; url: string; customer?: string }>(
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        customer_email: c.contactEmail,
        success_url: successUrl,
        cancel_url: cancelUrl,
        "metadata[company_id]": String(args.companyId),
        "metadata[company_slug]": c.slug,
        "metadata[tier]": args.tier,
        "metadata[source]": "directory_listings",
      },
    );

    const inserted = await db
      .insert(directoryListings)
      .values({
        companyId: args.companyId,
        tier: args.tier,
        status: "checkout_sent",
        monthlyPriceCents: tierConf.monthlyPriceCents,
        currency: "usd",
        stripeCheckoutSessionId: session.id,
        stripePriceId: priceId,
        checkoutUrl: session.url,
      })
      .returning({ id: directoryListings.id });

    const listingId = inserted[0].id;
    await recordEvent({
      listingId,
      eventType: "status_change",
      fromStatus: null,
      toStatus: "checkout_sent",
      payload: { sessionId: session.id, tier: args.tier, priceId },
    });

    return { url: session.url, listingId };
  }

  async function cancelListing(listingId: number): Promise<void> {
    const listing = await getListingById(listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.stripeSubscriptionId && stripeConfigured()) {
      try {
        await stripeRequest("DELETE", `/subscriptions/${listing.stripeSubscriptionId}`);
      } catch (err) {
        logger.warn({ err, listingId }, "directory-listings: stripe cancel failed");
      }
    }
    await db
      .update(directoryListings)
      .set({
        status: "canceled",
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(directoryListings.id, listingId));
    await recordEvent({
      listingId,
      eventType: "status_change",
      fromStatus: listing.status,
      toStatus: "canceled",
      payload: { reason: "manual_cancel" },
    });
  }

  async function addNote(listingId: number, note: string): Promise<void> {
    await recordEvent({
      listingId,
      eventType: "note",
      payload: { note },
    });
  }

  async function markOutreach(listingId: number | null, companyId: number): Promise<number> {
    // Either update existing listing, or create a prospect/contacted row.
    let id = listingId;
    if (!id) {
      const inserted = await db
        .insert(directoryListings)
        .values({
          companyId,
          tier: "featured",
          status: "contacted",
          monthlyPriceCents: LISTING_TIERS.featured.monthlyPriceCents,
          lastOutreachAt: new Date(),
        })
        .returning({ id: directoryListings.id });
      id = inserted[0].id;
    } else {
      await db
        .update(directoryListings)
        .set({
          lastOutreachAt: new Date(),
          status: sql`CASE WHEN status = 'prospect' THEN 'contacted' ELSE status END`,
          updatedAt: new Date(),
        })
        .where(eq(directoryListings.id, id));
    }
    await recordEvent({
      listingId: id,
      eventType: "outreach",
      payload: { at: new Date().toISOString() },
    });
    return id;
  }

  // ---------------------------------------------------------------------------
  // Traffic attribution — mentions + clicks we've driven to a company
  // ---------------------------------------------------------------------------
  async function getTrafficAttribution(companyId: number) {
    const company = await db
      .select()
      .from(intelCompanies)
      .where(eq(intelCompanies.id, companyId))
      .limit(1);
    if (company.length === 0) return null;
    const c = company[0];

    // Find content_items mentioning this company by slug or name.
    const mentionRows = await db.execute(sql`
      SELECT
        id, title, platform, status, click_count, engagement_score, published_at
      FROM content_items
      WHERE (
        body ILIKE ${"%" + c.name + "%"}
        OR body ILIKE ${"%" + c.slug + "%"}
        OR title ILIKE ${"%" + c.name + "%"}
      )
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT 20
    `);
    const mentions = (mentionRows as unknown as {
      rows?: Array<{
        id: string | number;
        title: string;
        platform: string;
        status: string;
        click_count: number | null;
        engagement_score: number | null;
        published_at: string | null;
      }>;
    }).rows
      ?? (mentionRows as unknown as Array<{
        id: string | number;
        title: string;
        platform: string;
        status: string;
        click_count: number | null;
        engagement_score: number | null;
        published_at: string | null;
      }>);

    const totalMentions = (mentions ?? []).length;
    const totalClicks = (mentions ?? []).reduce(
      (sum, m) => sum + Number(m.click_count ?? 0),
      0,
    );
    const totalEngagement = (mentions ?? []).reduce(
      (sum, m) => sum + Number(m.engagement_score ?? 0),
      0,
    );
    const publishedMentions = (mentions ?? []).filter(
      (m) => m.status === "published" || m.status === "scheduled",
    ).length;

    return {
      company: { id: c.id, slug: c.slug, name: c.name },
      totals: {
        mentions: totalMentions,
        publishedMentions,
        clicks: totalClicks,
        engagementScore: totalEngagement,
      },
      recentMentions: (mentions ?? []).slice(0, 10).map((m) => ({
        id: String(m.id),
        title: m.title,
        platform: m.platform,
        status: m.status,
        clickCount: Number(m.click_count ?? 0),
        publishedAt: m.published_at
          ? new Date(m.published_at).toISOString()
          : null,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Stripe webhook handler
  // ---------------------------------------------------------------------------
  async function handleStripeEvent(event: {
    type: string;
    data: { object: Record<string, unknown> };
  }): Promise<void> {
    const obj = event.data.object;
    logger.info({ type: event.type }, "directory-listings: stripe event");

    switch (event.type) {
      case "checkout.session.completed": {
        const session = obj as {
          id: string;
          customer?: string;
          subscription?: string;
          metadata?: Record<string, string>;
        };
        if (session.metadata?.source !== "directory_listings") return;
        const sessionId = session.id;
        const rows = await db
          .select()
          .from(directoryListings)
          .where(eq(directoryListings.stripeCheckoutSessionId, sessionId))
          .limit(1);
        if (rows.length === 0) {
          logger.warn({ sessionId }, "directory-listings: unknown checkout session");
          return;
        }
        const listing = rows[0];
        // Fetch subscription for period_end
        let currentPeriodEnd: Date | null = null;
        if (session.subscription) {
          try {
            const sub = await stripeRequest<{ current_period_end: number }>(
              "GET",
              `/subscriptions/${session.subscription}`,
            );
            currentPeriodEnd = new Date(sub.current_period_end * 1000);
          } catch (err) {
            logger.warn({ err }, "directory-listings: subscription fetch failed");
          }
        }
        await db
          .update(directoryListings)
          .set({
            status: "active",
            stripeCustomerId: session.customer ?? listing.stripeCustomerId,
            stripeSubscriptionId: session.subscription ?? listing.stripeSubscriptionId,
            startedAt: new Date(),
            currentPeriodEnd,
            updatedAt: new Date(),
          })
          .where(eq(directoryListings.id, listing.id));
        await recordEvent({
          listingId: listing.id,
          eventType: "stripe_webhook",
          fromStatus: listing.status,
          toStatus: "active",
          payload: { type: event.type, subscription: session.subscription },
        });

        // Send welcome email if we have a contact email
        {
          const company = await db
            .select()
            .from(intelCompanies)
            .where(eq(intelCompanies.id, listing.companyId))
            .limit(1);
          const c = company[0];
          if (c?.contactEmail) {
            const tierLabel = listing.tier.charAt(0).toUpperCase() + listing.tier.slice(1);
            await sendTransactional("directory-welcome", c.contactEmail, {
              recipientEmail: c.contactEmail,
              recipientName: c.contactName ?? undefined,
              companyName: c.name,
              listingTier: tierLabel,
              directoryUrl: `https://directory.coherencedaddy.com`,
              dashboardUrl: `https://coherencedaddy.com/intel`,
            });
          }
        }
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.paid": {
        const inv = obj as {
          subscription?: string;
          period_end?: number;
        };
        if (!inv.subscription) return;
        const rows = await db
          .select()
          .from(directoryListings)
          .where(eq(directoryListings.stripeSubscriptionId, inv.subscription))
          .limit(1);
        if (rows.length === 0) return;
        const listing = rows[0];
        await db
          .update(directoryListings)
          .set({
            status: "active",
            currentPeriodEnd: inv.period_end
              ? new Date(inv.period_end * 1000)
              : listing.currentPeriodEnd,
            updatedAt: new Date(),
          })
          .where(eq(directoryListings.id, listing.id));
        await recordEvent({
          listingId: listing.id,
          eventType: "stripe_webhook",
          fromStatus: listing.status,
          toStatus: "active",
          payload: { type: event.type },
        });
        break;
      }

      case "invoice.payment_failed": {
        const inv = obj as { subscription?: string };
        if (!inv.subscription) return;
        const rows = await db
          .select()
          .from(directoryListings)
          .where(eq(directoryListings.stripeSubscriptionId, inv.subscription))
          .limit(1);
        if (rows.length === 0) return;
        const listing = rows[0];
        await db
          .update(directoryListings)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(directoryListings.id, listing.id));
        await recordEvent({
          listingId: listing.id,
          eventType: "stripe_webhook",
          fromStatus: listing.status,
          toStatus: "past_due",
          payload: { type: event.type },
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = obj as { id?: string };
        if (!sub.id) return;
        const rows = await db
          .select()
          .from(directoryListings)
          .where(eq(directoryListings.stripeSubscriptionId, sub.id))
          .limit(1);
        if (rows.length === 0) return;
        const listing = rows[0];
        await db
          .update(directoryListings)
          .set({
            status: "canceled",
            canceledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(directoryListings.id, listing.id));
        await recordEvent({
          listingId: listing.id,
          eventType: "stripe_webhook",
          fromStatus: listing.status,
          toStatus: "canceled",
          payload: { type: event.type },
        });
        break;
      }
    }
  }

  return {
    listCompaniesWithListings,
    getStats,
    upsertContact,
    getCompanyListings,
    getListingById,
    getListingEvents,
    createCheckoutSession,
    cancelListing,
    addNote,
    markOutreach,
    getTrafficAttribution,
    handleStripeEvent,
  };
}

export type DirectoryListingsService = ReturnType<typeof directoryListingsService>;
