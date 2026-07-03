// ---------------------------------------------------------------------------
// Backend (VPS4) Brevo transactional email helper.
//
// Mirrors the landing's lib/brevo.ts: a plain HTTPS POST to Brevo's API using
// BREVO_API_KEY — no SDK (Node 18+ global fetch). Accepts the nodemailer-style
// { from, to, subject, html, bcc, attachments } shape used by the existing
// alerting + email-templates call sites so swapping in is a one-line change.
//
// `sendMailBrevoFirst` prefers Brevo and falls back to the provided nodemailer
// SMTP transport (Proton) if Brevo is unconfigured or its send fails — so this
// is additive resilience, not a hard cutover that can drop mail.
// ---------------------------------------------------------------------------
import { type Transporter } from "nodemailer";
import { logger } from "../middleware/logger.js";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export function brevoConfigured(): boolean {
  return !!process.env.BREVO_API_KEY;
}

type Addr = { email: string; name?: string };

interface MailAttachment {
  filename?: string;
  content?: Buffer | string;
  contentType?: string;
  cid?: string;
}

export interface BackendMailOpts {
  /** "Name <email>" or a bare email address. */
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  bcc?: string | string[];
  attachments?: MailAttachment[];
}

function parseAddr(s: string): Addr {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    const email = m[2].trim();
    return name ? { name, email } : { email };
  }
  return { email: s.trim() };
}

function toAddrList(v?: string | string[]): Addr[] | undefined {
  if (!v) return undefined;
  const list = (Array.isArray(v) ? v : [v]).filter(Boolean);
  return list.length ? list.map((email) => ({ email })) : undefined;
}

/** Send one email via Brevo's transactional API. Returns true on success. Never throws. */
export async function sendBrevoEmail(opts: BackendMailOpts): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return false;

  const body: Record<string, unknown> = {
    sender: parseAddr(opts.from),
    to: toAddrList(opts.to),
    subject: opts.subject,
    htmlContent: opts.html,
  };
  const bcc = toAddrList(opts.bcc);
  if (bcc) body.bcc = bcc;
  if (opts.attachments?.length) {
    body.attachment = opts.attachments
      .filter((a) => a.content != null)
      .map((a) => ({
        name: a.filename ?? "attachment",
        content: Buffer.isBuffer(a.content)
          ? a.content.toString("base64")
          : Buffer.from(String(a.content)).toString("base64"),
      }));
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.warn({ status: res.status, detail }, "[BREVO] send failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "[BREVO] send threw");
    return false;
  }
}

/**
 * Brevo-first delivery with optional SMTP fallback. Prefers Brevo when
 * BREVO_API_KEY is set; falls back to the provided nodemailer transport if
 * Brevo is unconfigured or its send fails. Returns true if either path sent.
 */
export async function sendMailBrevoFirst(
  opts: BackendMailOpts,
  smtpFallback?: Transporter | null,
): Promise<boolean> {
  if (brevoConfigured()) {
    if (await sendBrevoEmail(opts)) return true;
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "[BREVO] failed — trying SMTP fallback",
    );
  }
  if (smtpFallback) {
    await smtpFallback.sendMail({
      from: opts.from,
      to: opts.to,
      bcc: opts.bcc,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// READ helpers — Cockpit "email health" reads from Brevo's REST API.
//
// Same auth + fetch style as sendBrevoEmail above (api-key header, global
// fetch, no SDK), but GET. Each returns parsed JSON on success or `null` on any
// failure (unconfigured key, non-2xx, network/parse error) so callers can fall
// back to safe defaults instead of throwing — mirrors the "never break the
// dashboard" posture of the send path.
// ---------------------------------------------------------------------------

const BREVO_API_BASE = "https://api.brevo.com/v3";

/** GET <BREVO_API_BASE><path> with the api-key header. Parsed JSON or null. */
async function brevoGet<T = unknown>(path: string): Promise<T | null> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${BREVO_API_BASE}${path}`, {
      method: "GET",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.warn({ status: res.status, path, detail }, "[BREVO] GET failed");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ err, path }, "[BREVO] GET threw");
    return null;
  }
}

/** Format a Date as YYYY-MM-DD (UTC) for Brevo's statistics date params. */
function brevoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface BrevoAccount {
  email?: string;
  plan?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** GET /account — the Brevo account profile (login email, plan list). */
export async function getBrevoAccount(): Promise<BrevoAccount | null> {
  return brevoGet<BrevoAccount>("/account");
}

export interface BrevoEmailStats {
  range?: string;
  requests?: number;
  delivered?: number;
  hardBounces?: number;
  softBounces?: number;
  opens?: number;
  uniqueOpens?: number;
  clicks?: number;
  uniqueClicks?: number;
  [key: string]: unknown;
}

/**
 * GET /smtp/statistics/aggregatedReport — aggregated transactional email stats.
 * `startDate`/`endDate` are YYYY-MM-DD; default to the last 30 days.
 */
export async function getBrevoEmailStats(
  startDate?: string,
  endDate?: string,
): Promise<BrevoEmailStats | null> {
  const end = endDate ?? brevoDate(new Date());
  const start =
    startDate ?? brevoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  return brevoGet<BrevoEmailStats>(
    `/smtp/statistics/aggregatedReport?startDate=${start}&endDate=${end}`,
  );
}

export interface BrevoList {
  id?: number;
  name?: string;
  totalSubscribers?: number;
  uniqueSubscribers?: number;
  [key: string]: unknown;
}

/** GET /contacts/lists/{listId} — list metadata incl. subscriber counts. */
export async function getBrevoListCount(
  listId: number,
): Promise<BrevoList | null> {
  return brevoGet<BrevoList>(`/contacts/lists/${listId}`);
}

export interface BrevoContact {
  email?: string;
  id?: number;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BrevoListContacts {
  contacts?: BrevoContact[];
  count?: number;
  [key: string]: unknown;
}

/**
 * GET /contacts/lists/{listId}/contacts — ALL contacts on a list.
 *
 * Brevo caps a single page at 500 contacts, so this walks the limit/offset
 * pagination until a short (final) page is returned, accumulating every contact.
 * `pageSize` is the per-request page size (clamped to Brevo's 500 max). The loop
 * is bounded by MAX_PAGES to guarantee termination even if the API keeps
 * returning full pages (500 * 200 = 100k contacts — well past the founding list).
 * Returns null only if the FIRST page fails; a later-page failure returns
 * whatever was collected so far rather than dropping everything.
 */
export async function getBrevoListContacts(
  listId: number,
  pageSize = 500,
): Promise<BrevoListContacts | null> {
  const limit = Math.min(Math.max(pageSize, 1), 500);
  const MAX_PAGES = 200;
  const all: BrevoContact[] = [];
  let count: number | undefined;
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await brevoGet<BrevoListContacts>(
      `/contacts/lists/${listId}/contacts?limit=${limit}&offset=${offset}`,
    );
    if (!res) {
      // First page failed (unconfigured key / error) → propagate null. A later
      // page failing → return the contacts gathered so far.
      return offset === 0 ? null : { contacts: all, count: count ?? all.length };
    }
    const batch = res.contacts ?? [];
    all.push(...batch);
    if (typeof res.count === "number") count = res.count;
    if (batch.length < limit) break; // short page → last page
    offset += limit;
  }

  return { contacts: all, count: count ?? all.length };
}
