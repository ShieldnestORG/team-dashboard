import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { universityEmailLog, universityEmailEvents } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// University email-campaign analytics — inbound engagement events + stats.
//
// Brevo (the storefront's ESP) posts open/click/bounce webhooks to the
// coherencedaddy-landing storefront, which forwards each event here
// (POST /api/university/email-events) signed with HMAC-SHA256 over the raw
// request body using the shared secret EMAIL_EVENTS_KEY — the same symmetric
// scheme as the outbound creditscore email callback, in the other direction.
//
// Events land in university_email_events; `message_id` joins them back to the
// send log (university_email_log.message_id, captured at send time from the
// storefront's 202 { accepted, id } response). The stats rollup feeds
// GET /api/admin/university/email-stats so the owner can see which campaign
// kinds (and which links) actually get opened and clicked.
//
// Route wiring lives in routes/university-email-events.ts; this module keeps
// the verification / parsing / DB logic testable without an Express app.
// ---------------------------------------------------------------------------

// Signature header shape: X-Email-Events-Signature: v1=<hex hmac of raw body>.
// Mirrors signBody() in creditscore-email-callback.ts.
export function verifyEmailEventsSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = `v1=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const provided = Buffer.from(header);
  const wanted = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; unequal lengths are a mismatch.
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

// The event vocabulary we aggregate on. Anything else Brevo dreams up is
// clamped to 'other' so table cardinality stays bounded.
const KNOWN_EVENTS = new Set([
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "spam",
  "unsubscribed",
  "blocked",
  "other",
]);

export interface ParsedEmailEvent {
  messageId: string | null;
  email: string;
  kind: string | null;
  event: string;
  url: string | null;
  occurredAt: Date;
}

// Tolerant single-event parse. Returns null when the payload is unusable
// (missing email/event, or an unparseable `at` timestamp) — the route 400s.
export function parseEmailEvent(body: unknown): ParsedEmailEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const email =
    typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email) return null;

  const eventRaw =
    typeof b.event === "string" ? b.event.trim().toLowerCase() : "";
  if (!eventRaw) return null;
  const event = KNOWN_EVENTS.has(eventRaw) ? eventRaw : "other";

  const occurredAt = typeof b.at === "string" ? new Date(b.at) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) return null;

  // kind = first tag starting with 'university_' (the campaign kind the sender
  // tagged the Brevo message with), else null — untagged events still record.
  const tags = Array.isArray(b.tags) ? b.tags : [];
  const kind =
    tags.find(
      (t): t is string => typeof t === "string" && t.startsWith("university_"),
    ) ?? null;

  return {
    messageId:
      typeof b.messageId === "string" && b.messageId.length > 0
        ? b.messageId
        : null,
    email,
    kind,
    event,
    url: typeof b.url === "string" && b.url.length > 0 ? b.url : null,
    occurredAt,
  };
}

// Insert one event. Exact repeats (Brevo webhook retries re-forwarded by the
// storefront) no-op via ON CONFLICT DO NOTHING on the (message_id, event,
// occurred_at) unique index. NULL message_ids never collide (Postgres NULLs
// are distinct), so id-less events are always kept.
export async function recordEmailEvent(
  db: Db,
  evt: ParsedEmailEvent,
): Promise<void> {
  await db
    .insert(universityEmailEvents)
    .values({
      messageId: evt.messageId,
      email: evt.email,
      kind: evt.kind,
      event: evt.event,
      url: evt.url,
      occurredAt: evt.occurredAt,
    })
    .onConflictDoNothing({
      target: [
        universityEmailEvents.messageId,
        universityEmailEvents.event,
        universityEmailEvents.occurredAt,
      ],
    });
}

export interface UniversityEmailKindStats {
  kind: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  // opened / delivered and clicked / delivered (0 when nothing delivered) —
  // engagement rates over what actually reached an inbox, 4-decimal rounded.
  openRate: number;
  clickRate: number;
  topClickedUrls: Array<{ url: string; clicks: number }>;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

// Per-kind campaign rollup. `sent` counts send-log rows; the engagement
// counters count DISTINCT recipient emails per event (one member opening five
// times is one open). Three grouped queries, merged in code (Rule 5: the
// per-kind top-10 slice is cheaper here than a window function — kind
// cardinality is bounded by the CreditscoreEmailKind list).
export async function getUniversityEmailStats(
  db: Db,
  since?: Date,
): Promise<UniversityEmailKindStats[]> {
  const sentRows = await db
    .select({
      kind: universityEmailLog.kind,
      sent: sql<number>`count(*)::int`,
    })
    .from(universityEmailLog)
    .where(since ? gte(universityEmailLog.sentAt, since) : sql`true`)
    .groupBy(universityEmailLog.kind);

  const eventRows = await db
    .select({
      kind: universityEmailEvents.kind,
      event: universityEmailEvents.event,
      emails: sql<number>`count(distinct ${universityEmailEvents.email})::int`,
    })
    .from(universityEmailEvents)
    .where(
      and(
        isNotNull(universityEmailEvents.kind),
        since ? gte(universityEmailEvents.occurredAt, since) : sql`true`,
      ),
    )
    .groupBy(universityEmailEvents.kind, universityEmailEvents.event);

  const urlRows = await db
    .select({
      kind: universityEmailEvents.kind,
      url: universityEmailEvents.url,
      clicks: sql<number>`count(*)::int`,
    })
    .from(universityEmailEvents)
    .where(
      and(
        eq(universityEmailEvents.event, "clicked"),
        isNotNull(universityEmailEvents.kind),
        isNotNull(universityEmailEvents.url),
        since ? gte(universityEmailEvents.occurredAt, since) : sql`true`,
      ),
    )
    .groupBy(universityEmailEvents.kind, universityEmailEvents.url);

  const byKind = new Map<string, UniversityEmailKindStats>();
  const ensure = (kind: string): UniversityEmailKindStats => {
    let row = byKind.get(kind);
    if (!row) {
      row = {
        kind,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0,
        openRate: 0,
        clickRate: 0,
        topClickedUrls: [],
      };
      byKind.set(kind, row);
    }
    return row;
  };

  for (const r of sentRows) {
    ensure(r.kind).sent = Number(r.sent);
  }
  for (const r of eventRows) {
    if (!r.kind) continue;
    const row = ensure(r.kind);
    const n = Number(r.emails);
    switch (r.event) {
      case "delivered":
        row.delivered = n;
        break;
      case "opened":
        row.opened = n;
        break;
      case "clicked":
        row.clicked = n;
        break;
      case "bounced":
        row.bounced = n;
        break;
      case "unsubscribed":
        row.unsubscribed = n;
        break;
      default:
        break; // spam / blocked / other — recorded, not surfaced (yet)
    }
  }
  for (const r of urlRows) {
    if (!r.kind || !r.url) continue;
    ensure(r.kind).topClickedUrls.push({ url: r.url, clicks: Number(r.clicks) });
  }

  const out = [...byKind.values()];
  for (const row of out) {
    row.openRate = rate(row.opened, row.delivered);
    row.clickRate = rate(row.clicked, row.delivered);
    row.topClickedUrls = row.topClickedUrls
      .sort((a, b) => b.clicks - a.clicks || a.url.localeCompare(b.url))
      .slice(0, 10);
  }
  // Highest-volume campaigns first; stable tiebreak on kind.
  return out.sort((a, b) => b.sent - a.sent || a.kind.localeCompare(b.kind));
}
